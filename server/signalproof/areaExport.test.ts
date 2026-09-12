import { describe, expect, it } from "vitest";
import { areaView } from "./areas";
import { areaCsv, areaJson, areaTrend, badgeSvg } from "./areaExport";
import { measurement, snapshot } from "./fixtures";

/**
 * Exports are what a buyer actually receives: a CSV an analyst opens, a JSON a system ingests, a
 * badge a venue embeds. Each is derived from the same area view as the dashboard, so no number can
 * differ between what is shown and what is delivered.
 */

const view = () =>
  areaView(
    snapshot([
      measurement({ measurementRoot: "0x" + "11".repeat(32), timestamp: 1_789_000_100, latencyMs: 28, downloadMbps: 91, sourceBlockNumber: 2 }),
      measurement({ measurementRoot: "0x" + "22".repeat(32), timestamp: 1_789_000_000, latencyMs: 60, downloadMbps: 40, sourceBlockNumber: 1 }),
      measurement({ measurementRoot: "0x" + "33".repeat(32), timestamp: null, status: "AWAITING_ATTESTATION", creditcoinTxHash: null, rewardAmount: null, sourceBlockNumber: 3 }),
    ]),
    "qqguw6",
  )!;

describe("areaTrend", () => {
  it("orders samples by time and skips those without a timestamp", () => {
    const trend = areaTrend(view());
    expect(trend.map((p) => p.t)).toEqual([1_789_000_000_000, 1_789_000_100_000]);
    expect(trend[0]).toMatchObject({ quality: 55, latencyMs: 60, downloadMbps: 40 });
    expect(trend[1]).toMatchObject({ quality: 89, latencyMs: 28, downloadMbps: 91 });
  });
});

describe("areaCsv", () => {
  it("has the documented header, one row per sample, CRLF line ends and RFC 4180 quoting", () => {
    const v = view();
    v.samples[0].contributor = '0x"1,evil';
    const csv = areaCsv(v);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("measurementRoot,status,contributor,timestamp,latencyMs,downloadMbps,quality,sourceTxHash,creditcoinTxHash,rewardWei");
    expect(lines).toHaveLength(1 + v.samples.length + 1); // header + rows + trailing newline
    expect(lines[1]).toContain('"0x""1,evil"');
    // The awaiting row has no settlement and no reward: empty fields, not "null".
    const awaiting = lines.find((l) => l.startsWith("0x" + "33".repeat(32)))!;
    expect(awaiting).toContain(",AWAITING_ATTESTATION,");
    expect(awaiting.endsWith(",,")).toBe(true);
    expect(csv).not.toContain("null");
  });
});

describe("areaJson", () => {
  it("carries the area, generation time, aggregate and every sample with provenance", () => {
    const json = areaJson(view(), new Date("2026-09-12T10:00:00Z"));
    expect(json.area).toBe("qqguw6");
    expect(json.generatedAt).toBe("2026-09-12T10:00:00.000Z");
    expect(json.sampleCount).toBe(3);
    expect(json.samples[0].verifyUrl).toMatch(/^\/verify\/0x/);
    expect(JSON.stringify(json)).not.toMatch(/signature|nonce|sessionHash/);
  });
});

describe("badgeSvg", () => {
  it("names the area and quality with the colour of that quality band", () => {
    const strong = badgeSvg({ area: "qqguw6", quality: 86, samples: 9 });
    expect(strong).toContain("<svg");
    expect(strong).toContain("qqguw6");
    expect(strong).toContain("quality 86");
    expect(strong).toContain("9 samples");
    expect(strong).toContain("#31B7A6");
    expect(badgeSvg({ area: "qqguw6", quality: 65, samples: 1 })).toContain("#F4B95E");
    expect(badgeSvg({ area: "qqguw6", quality: 20, samples: 1 })).toContain("#F06A59");
  });
  it("renders a grey no-data badge for an unmeasured area and escapes the label", () => {
    const none = badgeSvg({ area: "<b>", quality: null, samples: 0 });
    expect(none).toContain("#8EA0AC");
    expect(none).toContain("no data");
    expect(none).not.toContain("<b>");
    expect(none).toContain("&lt;b&gt;");
  });
});
