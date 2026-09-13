# Quickstart

Three ways to run SignalProof, from zero configuration to a full relayer.

## Requirements

- **Node 22+** and **pnpm 10** (`corepack enable` installs pnpm from the `packageManager` field)
- **Foundry** only if you want to build or test the contracts
- **MySQL** is optional — without it, measurements are kept in memory and do not survive a restart; everything on chain is unaffected

## 1. Read-only in two minutes

A clone with only RPC URLs and the public contract addresses shows real settlements, the proof inspector and the buyer API. No key is needed to read.

```bash
git clone --recursive https://github.com/mdlog/signalproof.git
cd signalproof
pnpm install
cp .env.example .env     # pre-filled with the live testnet deployment
pnpm dev                 # http://localhost:3000
```

The sidebar's *Protocol rail* card reads **Read-only — no relayer key**: the dashboard reads both chains, but nothing can be submitted yet.

> If port 3000 is busy the server picks the next free port and prints it. Set `PORT` to pin one.

## 2. Accept and settle measurements

To relay measurements to Sepolia and settle them on Creditcoin, add two funded burner keys to `.env`:

```bash
SEPOLIA_RELAYER_PRIVATE_KEY=0x…      # pays gas on Sepolia; faucet links in .env.example
CREDITCOIN_RELAYER_PRIVATE_KEY=0x…   # pays gas on CC3 Testnet; CTC comes from the Discord faucet
```

Restart `pnpm dev`. The *Protocol rail* now reads **Attestcoin ready** and the worker ticks every 15 seconds. Connect a wallet, open **Run a test**, and a measurement goes phone → Sepolia → Creditcoin in about 9–13 minutes (see [Concepts](concepts.md#pipeline-status)).

Only the relayer address configured in the registry may submit — the registry is gated to the deployer's relayer. To run your own registry, see [Deploying the contracts](contracts.md#deploying).

## 3. In a container

```bash
docker build -t signalproof .
docker run --rm -p 3000:3000 --env-file .env signalproof
```

`fly.toml` and `render.yaml` are included; both hosts inject `PORT`. The image ships only production dependencies.

## Verify the toolchain

```bash
pnpm verify      # tsc --noEmit + vitest + forge test
pnpm smoke       # live Attestcoin read-path check against CC3 Testnet, no key needed
```

`pnpm smoke` resolves the Attestcoin chain key for Sepolia and prints the current attestation lag — the fastest way to tell whether a problem is yours or the network's.

## Testing from a laptop

The whole flow works in a desktop browser; a phone only adds the DePIN flavour.

- **Wallet.** Any EIP-6963 wallet extension (MetaMask, Rabby, OKX …). With several installed, the header shows a picker the first time; the choice is remembered.
- **Location.** Geolocation needs a *secure context*: `http://localhost` qualifies, `http://192.168.x.x` does not. A desktop without Wi-Fi location falls back to IP geolocation (±1,000 km), which the app refuses because it is coarser than one area cell. In Chrome, DevTools → *Sensors* → set a location; or use a phone over HTTPS.
- **Rate limit.** Three measurements per wallet per cell per ten minutes. For repeated takes use a second wallet or another cell.

## Testing from a phone

Geolocation on a phone needs HTTPS. Either deploy publicly, or tunnel the dev server:

```bash
cloudflared tunnel --url http://localhost:3000
```

The dev server already allows any host. Note that a tunnel exposes it publicly for as long as it runs.
