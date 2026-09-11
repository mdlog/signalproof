# SignalProof — Chain Core Design (Sub-proyek 1)

**Tanggal:** 2026-09-07
**Deadline hackathon:** 2026-09-14T03:59:00Z (~6,5 hari)
**Track:** DePIN (`isMultiTracksAllowed: false` — terkunci, satu track saja)
**Status:** disetujui untuk implementasi

---

## 1. Konteks

SignalProof adalah bukti konektivitas ter-crowdsource. Ponsel kontributor menjalankan foreground
network test; hasilnya dikomit sebagai hash ke Ethereum Sepolia, dibuktikan lintas rantai lewat
Attestcoin Protocol, lalu diselesaikan (settled) di Creditcoin CC3 Testnet yang memberi reward.

Repo saat ini punya UI prototipe fixture dan gateway tRPC + MySQL yang berjalan, tetapi **nol kode
chain**. Sub-proyek ini menutup gap itu.

### Kesesuaian track DePIN

Teks resmi track (verbatim, dorahacks.io/hackathon/buidl-ctc-2026-fall/detail):

> **3. DePIN** — *Build DePIN applications that utilize cross-chain data to drive incentives,
> settlement, or coordination across hardware and sensor networks.*

| Klausa | Padanan |
|---|---|
| DePIN applications | Ponsel kontributor sebagai node pengukur |
| utilize cross-chain data | `MeasurementSubmitted` (Sepolia) → attested → dikonsumsi di CC3 |
| drive incentives | `rewards[contributor]` + `claim()` |
| settlement | `SignalProofSettlement.sol` |
| coordination across hardware and sensor networks | Agregasi coverage per `areaHash` |

Klausa "utilize cross-chain data" bertumpang tindih dengan syarat tema wajib
(*"Every submission this season must leverage the Attestcoin Protocol"*), sehingga integrasi
Attestcoin adalah inti definisi track, bukan kewajiban terpisah yang ditempelkan.

⚠️ Hadiah bersifat **overall, bukan per-track** (Grand $10.000 / 2nd $3.000 / 3rd $2.000 untuk 5
track). Pemilihan track tidak memperbaiki peluang secara mekanis; nilainya adalah koherensi narasi.

---

## 2. Fakta protokol yang mengikat desain

Semua diverifikasi live pada 2026-09-07. Nilai yang salah akan mematahkan build.

| Parameter | Nilai |
|---|---|
| SDK | `@gluwa/usc-sdk@0.18.0` — CommonJS, deps `ethers ^6.15.0`, **tanpa** `peerDependencies` |
| Kontrak dasar | `@gluwa/asc-contracts@0.2.1` → `contracts/readability/ASCBase.sol`, `pragma ^0.8.28` |
| CC3 Testnet | chain id `102031` (`0x18e8f`), RPC `https://rpc.cc3-testnet.creditcoin.network`, explorer Blockscout `https://creditcoin-testnet.blockscout.com/`, native `CTC`, block 15 s, gas 0,5 gwei, block gas limit 75.000.000 |
| Ethereum Sepolia | chain id `11155111`, RPC `https://ethereum-sepolia-rpc.publicnode.com` |
| Precompile ChainInfo | `0x0000000000000000000000000000000000000fd3` |
| Precompile BlockProver | `0x0000000000000000000000000000000000000FD2` |
| `chainKey` Sepolia @ CC3 Testnet | `1` — **uint64**, di-resolve runtime, tidak di-hardcode |
| Compiler | `solc 0.8.30`, `evm_version = shanghai`, `optimizer_runs = 200`, **`via_ir = true`** |
| `execute` selector | `0xc6339bf7` = `execute(uint8,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[])` |
| Latensi attestation | 7,2–8,4 menit steady-state; total e2e 9–13 menit |

### Koreksi terhadap dokumen internal

`docs/TECHNICAL_ARCHITECTURE.md` ditulis sebelum verifikasi. Tiga hal salah:

1. **`chainKey` bukan string.** Ia `uint64`. Resolve via `getSupportedChains()` lalu cocokkan
   `chainId === 11155111` — **bukan** `chainName` (chain mengembalikan `"Sepolia ethereum"`).
2. **`verifySingle` tidak menghasilkan transaksi.** Ia `eth_call` read-only yang mengembalikan
   `boolean`. Jalur yang menghasilkan tx on-chain adalah `ASCBase.execute(...)`.
3. **Pola `SimpleMinterASC` di halaman docs usang dan cacat keamanan** — ia melewatkan emitter
   binding. Bangun dari `github.com/gluwa/attestcoin-protocol-examples`, bukan dari halaman docs.

---

## 3. Arsitektur

```
Ponsel / PWA
   │ measurement payload (tRPC)
   ▼
SignalProof Gateway (Express + tRPC)          ← SUDAH ADA
   │ insert row status=SUBMITTED
   ▼
MySQL measurements                            ← SUDAH ADA, diperluas
   │
   ├──► Relayer ──────► SourceBatchRegistry (Sepolia 11155111)   ← BARU
   │                      emit MeasurementSubmitted
   │                      simpan sourceTxHash + sourceBlockNumber
   │                      status → AWAITING_ATTESTATION
   │
   └──► Proof Worker ──► Attestcoin ProofBuilder                  ← BARU
          tick 15 s        getLatestAttestedHeightAndHash(chainKey)
          non-blocking     ≥ sourceBlockNumber ? getProof(txHash) : skip
                           │
                           ▼
                     SignalProofSettlement (CC3 102031)           ← BARU
                       ASCBase.execute(...)
                       → MeasurementVerified
                       status → PROOF_VERIFIED → SETTLED
```

Batas unit: `contracts/` (Foundry, terisolasi dari pnpm), `server/signalproof/` (Node server-side
saja — SDK CommonJS tidak boleh masuk bundle Vite client).

---

## 4. Kontrak

### 4.1 `SourceBatchRegistry.sol` — Ethereum Sepolia

Kecil dan sengaja bodoh. Tidak menyimpan koordinat mentah atau PII.

```solidity
event MeasurementSubmitted(
    bytes32 indexed measurementRoot,
    bytes32 indexed areaHash,
    address indexed contributor,
    bytes32 sessionHash,
    uint256 timestamp,
    uint256 latencyMs,
    uint256 downloadMbps
);

mapping(bytes32 => bool) public registered;

function submitMeasurement(
    bytes32 measurementRoot, bytes32 areaHash, address contributor,
    bytes32 sessionHash, uint256 timestamp, uint256 latencyMs, uint256 downloadMbps
) external;
```

**Penyimpangan dari `docs/TECHNICAL_ARCHITECTURE.md:84-102`:** field `address indexed contributor`
ditambahkan. Pseudocode dokumen tidak punya field ini, sehingga sisi CC3 tidak akan tahu siapa yang
harus dibayar. Tanpa ini, alur incentive tidak bisa ditutup.

### 4.2 `SignalProofSettlement.sol` — Creditcoin CC3 Testnet

```solidity
contract SignalProofSettlement is ASCBase, Ownable {
    constructor(address sourceRegistry_) Ownable(msg.sender) { ... }

    function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction)
        internal override { ... }
}
```

`ASCBase` menyediakan `execute()`, `_computeQueryId`, `_verifyProof`, dan replay-guard
`processedQueries` secara gratis. Kita override **hanya** `_processAndEmitEvent`.

`ASCBase` tidak punya constructor args dan `execute()` tidak punya access control
(permissionless relay by design) — **seluruh otorisasi harus hidup di `_processAndEmitEvent`.**

#### Dua cek keamanan wajib

Precompile **tidak** melakukan keduanya untuk kita:

```solidity
// 1. Precompile hanya membuktikan inklusi, bukan keberhasilan.
require(receipt.receiptStatus == 1, "Transaction did not succeed");

// 2. Emitter binding — tanpa ini siapa pun bisa deploy kontrak lookalike,
//    emit MeasurementSubmitted palsu, dan mem-prove-nya.
require(sourceRegistry != address(0), "Source registry not registered");
require(log.address_ == sourceRegistry, "Event not emitted by registered SourceBatchRegistry");
```

Cek (2) adalah yang **hilang** dari contoh `SimpleMinterASC` di halaman docs resmi. Ini bug
keamanan yang akan diwarisi siapa pun yang menyalin halaman itu.

#### Logika settlement

1. Decode `encodedTransaction` dengan `EvmV1Decoder` (di-import di level **source**, bukan lewat
   alamat — riset menemukan dua alamat decoder yang berkonflik antara docs dan repo).
2. Cek receipt status + emitter binding.
3. Cocokkan `topic0 == MeasurementSubmitted.selector`; parse `measurementRoot`, `areaHash`,
   `contributor` dari topics, sisanya dari data.
4. Freshness: `block.timestamp - timestamp <= MAX_AGE` (default 24 jam, `onlyOwner` configurable).
5. Replay: `require(!settled[measurementRoot])` — lapisan kedua di atas `processedQueries`
   milik `ASCBase`, karena keduanya menjaga hal berbeda (`queryId` per source-tx vs
   `measurementRoot` per measurement).
6. Akrual: `rewards[contributor] += rewardAmount`.
7. `emit MeasurementVerified(measurementRoot, areaHash, contributor, rewardAmount)`.

Jalur gagal memakai `revert` dengan pesan spesifik → relayer mencatatnya sebagai `rejectionCode`.

#### Pembayaran — pola pull

```solidity
mapping(address => uint256) public rewards;
function claim() external { uint256 a = rewards[msg.sender]; rewards[msg.sender] = 0; ... }
receive() external payable {}          // funding kontrak
function setRewardAmount(uint256) external onlyOwner;
function setSourceRegistry(address) external onlyOwner;
function withdraw(uint256) external onlyOwner;
```

Transfer tidak terjadi di jalur verifikasi — melindungi dari reentrancy dan gas griefing, dan
menjaga `execute()` tetap murah.

---

## 5. Relayer & Proof Worker

Satu `setInterval` 15 detik di dalam proses Express. Tidak ada infrastruktur baru.

### 5.1 Tick non-blocking — penyimpangan yang disengaja

Contoh resmi Gluwa memakai `proofBuilder.waitUntilHeightAttested(...)` yang **memblokir 8–20
menit**. Di dalam worker polling, itu membekukan seluruh antrean.

Kita pakai `chainInfoProvider.getLatestAttestedHeightAndHash(chainKey)` — satu `eth_call`, < 1
detik — lalu bandingkan dengan `sourceBlockNumber` baris dan lanjut hanya jika sudah terlewati.
Satu tick selesai dalam hitungan detik; banyak measurement diproses paralel.

Worker **tidak pernah** mengasumsikan interval attestation 10 block: angka itu hanya inferensi dari
delta terukur dan merupakan runtime setting yang bisa diubah operator.

### 5.2 Mesin status

Memakai persis kelima nilai `measurementStatus` yang sudah ada di `drizzle/schema.ts:19-25`, dan
menulis kelima kolom yang selama ini tidak pernah tersentuh.

```
SUBMITTED
  └─ relayer: submitMeasurement() di Sepolia
     simpan sourceTxHash, sourceBlockNumber, contributorAddress
     → AWAITING_ATTESTATION

AWAITING_ATTESTATION
  └─ attestedHeight >= sourceBlockNumber ?
       tidak → skip tick ini
       ya   → getProof(txHash) → cek .success → unwrap .data
              → execute(...) di CC3, simpan creditcoinTxHash, headerNumber
     → PROOF_VERIFIED

PROOF_VERIFIED
  └─ baca MeasurementVerified dari receipt (bukan filter)
     simpan rewardAmount
     → SETTLED

gagal permanen (apa pun) → REJECTED + rejectionCode
```

### 5.3 Empat jebakan yang disalin verbatim dari repo resmi

| # | Jebakan | Penanganan |
|---|---|---|
| 1 | `chainKey` di-hardcode | Resolve saat startup via `getSupportedChains()`, match `chainId === 11155111`. Kalau RPC tertukar ke mainnet, `1` diam-diam berubah arti jadi Ethereum mainnet |
| 2 | `getProof()` mengembalikan `ProofResult`, **bukan** `ContinuityResponse` | Cek `.success`, lalu unwrap `.data`. Melewatkannya = `tsc` gagal + `chainKey` undefined saat runtime |
| 3 | Timeout konstruktor `ProofBuilder` default 10 s, **tanpa retry** | Lewatkan timeout eksplisit lebih besar sebagai argumen ke-3 + backoff sendiri |
| 4 | `estimateGas` **gagal terhadap precompile** walau call-nya akan sukses | try/catch + fallback `21000 + continuityLength*5000 + 20000`, buffer 35% |

### 5.4 Ketahanan

Backoff eksponensial dengan `attempts`, `nextAttemptAt`, `lastError`. `MAX_ATTEMPTS` sebelum
`REJECTED`. Worker selalu memprove tx segar — menunggu 24 jam menaikkan biaya gas **~10×**
(`2,6×10⁻⁵` → `3,1×10⁻⁴` CTC).

Ketika env chain tidak lengkap, `getIntegrationReadiness()` mengembalikan
`{ missing: [...], proofWorkerReady: false }` dan worker **tidak dijalankan**. Gateway tetap
menerima measurement dan menyimpannya sebagai `SUBMITTED`. Tidak ada kegagalan diam-diam, tidak ada
klaim palsu bahwa sesuatu terverifikasi.

---

## 6. Perubahan data model

Kolom baru di `measurements`:

| Kolom | Tipe | Alasan |
|---|---|---|
| `contributorAddress` | `varchar(42)` | Alamat EVM penerima reward |
| `chainKey` | `int` | Dicatat agar audit trail tidak ambigu antar jaringan |
| `headerNumber` | `varchar(32)` | Dari `proofData.headerNumber` |
| `attempts` | `int` default 0 | Backoff |
| `nextAttemptAt` | `timestamp` nullable | Backoff |
| `lastError` | `text` nullable | Diagnostik, disanitasi |

Perubahan lain:

- `nonce` mendapat `.unique()` — `docs/TECHNICAL_ARCHITECTURE.md:76` mengklaim nonce uniqueness
  tetapi schema tidak pernah menegakkannya.
- Index `(status, nextAttemptAt)` — worker query ini tiap 15 detik; tabel saat ini **tidak punya
  index sama sekali** selain PK dan unique.
- `drizzle/meta/_journal.json` harus dibuat sebelum `drizzle-kit generate` berikutnya, agar migrasi
  `0000_burly_shiver_man.sql` tidak jadi yatim.
- `server/db.ts` mendapat fungsi **update pertamanya**. Saat ini nol — itulah sebabnya tidak ada
  jalur kode yang bisa memajukan status melewati `SUBMITTED`.

---

## 7. Testing

### Foundry

| Test | Yang dijaga |
|---|---|
| `testRejectsWrongEmitter` | Emitter palsu `address(0xBAD)` ditolak. Meniru `ASCLoanManagerSourceBinding.t.sol` milik Gluwa |
| `testRejectsFailedReceipt` | `receiptStatus != 1` ditolak |
| `testRejectsReplayedMeasurementRoot` | Replay guard lapis kedua |
| `testRejectsStaleMeasurement` | Freshness |
| `testAccruesReward` / `testClaim` | Pola pull, saldo benar, klaim ganda gagal |
| `testSourceRegistryDedup` | `registered[root]` di Sepolia |

### vitest

Menutup `todo.md:19` yang saat ini nol untuk ketiganya:

- `buildSourceMeasurementEvent` — pemetaan payload → bentuk event
- `getIntegrationReadiness` — pelaporan env yang hilang
- Transisi status — setiap edge di §5.2
- Duplicate protection — `measurementRoot` dan `nonce`

Menulis `server/signalproof/worker.ts` sekaligus memperbaiki `pnpm test` yang saat ini exit
non-zero karena `server/signalproof.test.ts:3` mengimpor modul yang tidak ada.

### End-to-end

Karena deploy diblokir, e2e dijalankan dua lapis:

1. **Anvil fork** — `SourceBatchRegistry` + `SignalProofSettlement` dengan verifier di-mock,
   membuktikan seluruh logika kontrak dan mesin status tanpa jaringan.
2. **Smoke test SDK live** — terhadap kontrak Gluwa yang **sudah ter-deploy** di CC3 Testnet +
   Sepolia, membuktikan jalur `PrecompileChainInfoProvider` → `ProofBuilder` benar-benar hidup dari
   mesin ini. Tidak memerlukan deploy kita sendiri.

---

## 8. Konfigurasi & secrets

`.env.example` baru (saat ini tidak ada sama sekali) mendokumentasikan delapan variabel chain di
`server/_core/env.ts:10-17` plus `DATABASE_URL` dan `JWT_SECRET`.

Deployer memakai **burner key khusus testnet** yang di-generate lokal, disimpan di `.env` yang
gitignored, tidak pernah menyentuh mainnet, tidak pernah dipakai ulang.

**Risiko toolchain yang diuji lebih dulu:** config Foundry Gluwa dikembangkan terhadap yarn 1.22
(hoisted flat). pnpm 10 memakai `node_modules` terisolasi/symlink; hanya direct dependency yang
muncul di top level, dependency Solidity transitif tidak akan resolve. Uji empiris
`pnpm install && forge build` sebelum menulis kontrak. Kalau gagal → `.npmrc` dengan
`node-linker=hoisted`, atau deklarasikan setiap dep Solidity sebagai direct dependency.

---

## 9. Batasan yang diterima

- **Demo live real-time mustahil.** Attestation 7,2–8,4 menit; e2e 9–13 menit. Video demo harus
  pre-warm proof atau memotong tunggu. UI menampilkan `AWAITING_ATTESTATION` secara jujur.
- **Readability saja** (Sepolia → CC3). Write-ability (Outbox/Inbox/RelayerContract) tidak punya
  reference implementation dan belum lolos audit pihak ketiga — terlalu berisiko untuk 6,5 hari.
- **Attested ≠ finalized.** Attestation berjalan 65–85 block di depan tag `finalized` Sepolia. Deep
  reorg secara prinsip bisa menginvalidasi height yang sudah attested. Dicatat sebagai security note
  di README, bukan diperbaiki.
- **Rubrik penjurian tidak dipublikasikan.** Satu-satunya kriteria tertulis adalah *"Depth of
  Attestcoin Protocol utilization"*. Tidak ada bobot rubrik yang diasumsikan di mana pun.

---

## 10. Diblokir untuk manusia

1. **Faucet CC3 Testnet** — tidak ada web faucet. Discord `discord.gg/creditcoin` → `#token-faucet`
   → `/faucet address:<burner>`. Jumlah dispense dan rate limit tidak terdokumentasi di mana pun.
   Ini satu-satunya jalur yang bisa memblokir seluruh deliverable.
2. **Faucet Sepolia** — `faucet.quicknode.com/ethereum/sepolia` (tanpa gate saldo mainnet) atau
   `sepolia-faucet.pk910.de` (PoW, tanpa prasyarat).
3. **Deploy kontrak** — script disiapkan lengkap; perintahnya tinggal dijalankan.
4. **Submit form DoraHacks** — 7 field wajib. Registrasi tim per-anggota (Country of Residence dan
   Country of Citizenship wajib) harus dilakukan masing-masing orang saat registrasi, bukan saat
   submit.
