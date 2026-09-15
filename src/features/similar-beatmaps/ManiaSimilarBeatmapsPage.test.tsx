import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModeProvider, useMode } from "../../app/ModeContext";
import { desktopApi } from "../../shared/lib/tauri";
import type {
  ManiaSimilarityQueryResponse,
  ManiaSimilarityRecommendationResponse,
  Ruleset,
  SimilarityIndexStatus,
} from "../../shared/types/osu";
import { collectionAddEvent } from "../collections/events";
import { settingsQueryKey } from "../settings/api";
import { defaultSimilarityPreferences } from "./defaults";
import { SimilarBeatmapsPage } from "./SimilarBeatmapsPage";

vi.mock("./SimilarityRadar", () => ({
  SimilarityRadar: ({ comparison }: { comparison?: Record<string, number> | null }) => (
    <div data-testid={comparison ? "comparison-radar" : "target-radar"} />
  ),
}));

const maniaReady: SimilarityIndexStatus = {
  ruleset: "mania",
  state: "ready",
  directory: "E:/osu-mania-ranked",
  message: "Mania 索引已就绪。",
  record_count: 23_551,
  analyzer_version: 1,
  normalization_version: 1,
  algorithm_id: "mania-roxy-interlude-similarity-v1",
  data_cutoff_at: null,
  supports_dynamic_weighting: false,
  records_by_key_count: { 4: 18_550, 6: 800, 7: 4_201 },
};

const osuReady: SimilarityIndexStatus = {
  ...maniaReady,
  ruleset: "osu",
  directory: "D:/osu-index",
  record_count: 100,
  analyzer_version: 4,
  algorithm_id: "five-dimension-slider-rosu-reading-v4",
  supports_dynamic_weighting: true,
  records_by_key_count: null,
};

const difficulty = {
  speed: 0.72,
  hand_stream: 0.68,
  jack: 0.44,
  chordjack: 0.61,
  technical: 0.57,
  stamina: 0.64,
  long_note: 0.18,
  course: 0.51,
};

const style = {
  stream: 0.72,
  chordstream: 0.58,
  jacks: 0.37,
  coordination: 0.49,
  density: 0.66,
  wildcard: 0.21,
  chord_rate: 0.34,
  large_chord_rate: 0.12,
  rotation_rate: 0.48,
  anchor_rate: 0.22,
  rhythm_entropy: 0.59,
  transition_entropy: 0.54,
  ln_note_ratio: 0.08,
  hold_occupancy: 0.06,
  hybrid_row_ratio: 0.04,
  peak_to_sustain_gap: 0.31,
};

const base = {
  bpm: 180,
  length_seconds: 132,
  active_length_seconds: 116,
  note_count: 812,
  row_count: 687,
  avg_nps: 7,
  peak_nps: 12.4,
  break_density: 0.12,
  sv_change_rate: 0,
};

const patternView = {
  category: "Shield",
  mode_tag: "Mix",
  coverage: [0.52, 0.31, 0.12, 0.66, 0.48, 0.09],
  bars: [
    { pattern: "Coordination", amount: 158_000, relative: 0.66, specific_types: [["Shield", 0.092], ["Chordjack", 0.041]] as [string, number][] },
    { pattern: "Wildcard", amount: 239_000, relative: 1, specific_types: [] as [string, number][] },
  ],
  subtypes: [["Shield", 0.092]] as [string, number][],
  ln_note_ratio: 0.234,
  intensity: [6.4, 12.1, 5.2, 18.5],
  temporal: [0.42, 0.18, 0.12],
  duration_seconds: 120,
  sv_amount: 0,
};

const target = {
  ruleset: "mania" as const,
  beatmap_id: 3001,
  beatmapset_id: 701,
  artist: "Reference",
  title: "Key Target",
  version: "4K Another",
  creator: "Mapper",
  online_url: "https://osu.ppy.sh/beatmaps/3001",
  key_count: 4 as const,
  family: "rc" as const,
  pattern: "stream" as const,
  difficulty,
  style,
  base,
  difficulty_percentile: 0.78,
  difficulty_band: 7,
  game_mod: "NM" as const,
  pattern_view: patternView,
};

function maniaResult(beatmapId: number, keyCount: 4 | 6 | 7, title: string) {
  return {
    ...target,
    beatmap_id: beatmapId,
    beatmapset_id: beatmapId + 100,
    title,
    version: `${keyCount}K Another`,
    key_count: keyCount,
    family: keyCount === 6 ? "hb" as const : "rc" as const,
    pattern: keyCount === 6 ? "coordination" as const : "stream" as const,
    pattern_view: { ...patternView, category: "Jumpstream/Handstream Tech", mode_tag: "RC", ln_note_ratio: 0.05 },
    final_distance: 0.054,
    distance_components: { skill: 0.04, pattern: 0.06, structure: 0.08, difficulty: 0.03, context: 0.05 },
  };
}

const queryResponse: ManiaSimilarityQueryResponse = {
  ruleset: "mania",
  target: { ...target, source: "index", analyzer_version: 1, normalization_version: 1 },
  results: [maniaResult(3101, 4, "Stream Candidate")],
};

const recommendationResponse: ManiaSimilarityRecommendationResponse = {
  ruleset: "mania",
  kind: "recent",
  seed_count: 15,
  skipped_seed_count: 2,
  groups: [
    {
      key_count: 4,
      seed_count: 10,
      results: Array.from({ length: 6 }, (_, index) => ({
        ...maniaResult(3200 + index, 4, `4K Recommendation ${index + 1}`),
        recommended_by: target,
      })),
    },
    {
      key_count: 6,
      seed_count: 5,
      results: [{ ...maniaResult(3301, 6, "6K Recommendation"), recommended_by: { ...target, key_count: 6 } }],
    },
    { key_count: 7, seed_count: 0, results: [] },
  ],
};

function ModeProbe() {
  const { ruleset, setRuleset } = useMode();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <output data-testid="active-ruleset">{ruleset}</output>
      <output data-testid="similarity-location">{location.pathname + location.search}</output>
      {(["osu", "mania", "taiko"] as Ruleset[]).map((mode) => <button key={mode} onClick={() => setRuleset(mode)} type="button">切换 {mode}</button>)}
      <button onClick={() => navigate("?source=beatmap_id&value=3001&ruleset=mania")} type="button">打开 Mania search 深链</button>
    </div>
  );
}

function renderPage(mode: Ruleset = "mania", entry = "/online/similar") {
  localStorage.setItem("opp.global-ruleset", mode);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(settingsQueryKey, {
    similarity_preferences: defaultSimilarityPreferences,
    preview_volume: 65,
    default_beatmap_download_provider: "hinai",
    include_video_in_beatmap_downloads: true,
    beatmap_download_directory: "D:/downloads",
  });
  return render(
    <QueryClientProvider client={client}>
      <ModeProvider>
        <MemoryRouter initialEntries={[entry]}>
          <ModeProbe />
          <SimilarBeatmapsPage />
        </MemoryRouter>
      </ModeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Mania similarity", () => {
  it("queries with the Mania contract and keeps collection ruleset and mode state isolated", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockImplementation(async (ruleset) => ruleset === "mania" ? maniaReady : osuReady);
    const query = vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue(queryResponse);
    const collectionEvents: unknown[] = [];
    window.addEventListener(collectionAddEvent, (event) => collectionEvents.push((event as CustomEvent).detail), { once: true });

    renderPage();
    expect(await screen.findByText("Mania 索引已就绪")).toBeInTheDocument();
    expect(screen.queryByText("展开高级参数")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /候选谱面筛选/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Beatmap ID 或 osu! 链接"), "3001");
    await user.click(screen.getByRole("button", { name: "DT" }));
    await user.click(screen.getByLabelText("NM / DT / HT 多 Mod 混池"));
    await user.click(screen.getByRole("button", { name: "查找相似谱面" }));

    expect(await screen.findByText("Reference - Stream Candidate")).toBeInTheDocument();
    expect(screen.getByText("RC")).toBeInTheDocument();
    expect(screen.getAllByText("78%").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Mania 距离分量")).not.toBeInTheDocument();
    expect(screen.getByTestId("comparison-radar")).toBeInTheDocument();
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ ruleset: "mania", source: { kind: "beatmap_id", value: "3001" }, result_limit: 50, target_mod: "DT", candidate_mods: ["NM", "DT", "HT"] }));

    await user.click(screen.getByRole("button", { name: "加入收藏夹" }));
    expect(collectionEvents).toEqual([[expect.objectContaining({ ruleset: "mania", beatmap_id: 3101 })]]);

    await user.click(screen.getByRole("button", { name: "切换 osu" }));
    expect(await screen.findByText("索引已就绪")).toBeInTheDocument();
    expect(screen.queryByText("Reference - Stream Candidate")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换 mania" }));
    expect(await screen.findByText("Reference - Stream Candidate")).toBeInTheDocument();
  });

  it("shows the analyser main mode and the RC/LN note share for the reference chart and each result", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue(queryResponse);

    renderPage();
    await user.type(await screen.findByLabelText("Beatmap ID 或 osu! 链接"), "3001");
    await user.click(screen.getByRole("button", { name: "查找相似谱面" }));
    expect(await screen.findByText("Reference - Stream Candidate")).toBeInTheDocument();

    expect(screen.getByText("Mix / Shield")).toBeInTheDocument();
    expect(screen.getAllByText("Mix · Shield").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RC 76.6%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LN 23.4%").length).toBeGreaterThan(0);
    expect(screen.getByText("Jumpstream/Handstream Tech")).toBeInTheDocument();
    expect(screen.getByText("RC · Jumpstream/Handstream Tech")).toBeInTheDocument();
    expect(screen.getAllByText("RC 95.0%").length).toBeGreaterThan(0);
    const wildcardMeters = screen.getAllByRole("meter", { name: "Wildcard 相对量" });
    expect(wildcardMeters.length).toBeGreaterThan(0);
    expect(wildcardMeters.every((meter) => meter.getAttribute("aria-valuenow") === "100")).toBe(true);
    expect(screen.queryByText(/分类依据|相对键型量|模式可以重叠/)).not.toBeInTheDocument();
  });

  it("keeps today's Mania layout when the dataset has no key-pattern records", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue({
      ...queryResponse,
      target: { ...queryResponse.target, pattern_view: null },
      results: queryResponse.results.map((result) => ({ ...result, pattern_view: null })),
    });

    renderPage();
    await user.type(await screen.findByLabelText("Beatmap ID 或 osu! 链接"), "3001");
    await user.click(screen.getByRole("button", { name: "查找相似谱面" }));
    expect(await screen.findByText("Reference - Stream Candidate")).toBeInTheDocument();

    expect(screen.getByText("RC / stream")).toBeInTheDocument();
    expect(screen.getByText("stream")).toBeInTheDocument();
    expect(screen.queryByText(/Mix · Shield|RC 76.6%|LN 23.4%/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("RC 与 LN 音符占比")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("MMA 键型分布")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("keeps the legacy comparison when only the candidate has key-pattern records", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue({
      ...queryResponse,
      target: { ...queryResponse.target, pattern_view: null },
    });

    renderPage();
    await user.type(await screen.findByLabelText("Beatmap ID 或 osu! 链接"), "3001");
    await user.click(screen.getByRole("button", { name: "查找相似谱面" }));
    expect(await screen.findByText("Reference - Stream Candidate")).toBeInTheDocument();

    expect(screen.getAllByText("候选谱面").length).toBeGreaterThan(0);
    expect(screen.queryByText("参考谱面")).not.toBeInTheDocument();
    expect(screen.getAllByText("八维相对强项").length).toBeGreaterThan(0);
  });

  it("keeps the legacy comparison when only the reference has key-pattern records", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue({
      ...queryResponse,
      results: queryResponse.results.map((result) => ({ ...result, pattern_view: null })),
    });

    renderPage();
    await user.type(await screen.findByLabelText("Beatmap ID 或 osu! 链接"), "3001");
    await user.click(screen.getByRole("button", { name: "查找相似谱面" }));
    expect(await screen.findByText("Reference - Stream Candidate")).toBeInTheDocument();

    expect(screen.getAllByText("参考谱面").length).toBeGreaterThan(0);
    expect(screen.queryByText("候选谱面")).not.toBeInTheDocument();
    expect(screen.getAllByText("八维相对强项").length).toBeGreaterThan(0);
  });

  it("groups recommendations into independently paged 4K, 6K and 7K tabs and records Mania history", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    vi.spyOn(desktopApi, "recommendSimilarBeatmaps").mockImplementation(async (request) => ({
      ...recommendationResponse,
      kind: request.kind,
      groups: request.seed_limit === 5
        ? recommendationResponse.groups.map((group) => ({ ...group, results: [] }))
        : recommendationResponse.groups,
    }));

    renderPage();
    await user.click(await screen.findByRole("button", { name: "根据最近游玩推荐" }));
    expect(await screen.findByText("Reference - 4K Recommendation 1")).toBeInTheDocument();
    expect(screen.queryByText("Reference - 4K Recommendation 6")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /4K · 6/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /7K · 0/ })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("opp.similarity-recommendation-history.v2")).toContain('"ruleset":"mania"'));
    expect(localStorage.getItem("opp.similarity-recommendation-history.v2")).toContain('"key_count":4');

    await user.click(screen.getByRole("button", { name: "换一批" }));
    expect(screen.getByText("Reference - 4K Recommendation 6")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /6K · 1/ }));
    expect(screen.getByText("Reference - 6K Recommendation")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /4K · 6/ }));
    expect(screen.getByText("Reference - 4K Recommendation 6")).toBeInTheDocument();
  });

  it("does not repeat the displayed quick batch when the deferred Mania response completes", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    const quickResults = Array.from({ length: 3 }, (_, index) => ({
      ...maniaResult(3400 + index, 4, `Quick Recommendation ${index + 1}`),
      recommended_by: target,
    }));
    const freshResults = Array.from({ length: 5 }, (_, index) => ({
      ...maniaResult(3500 + index, 4, `Full Recommendation ${index + 1}`),
      recommended_by: target,
    }));
    const quickSixKey = {
      ...maniaResult(3600, 6, "Quick 6K Recommendation"),
      recommended_by: { ...target, key_count: 6 as const },
    };
    const freshSixKey = {
      ...maniaResult(3601, 6, "Full 6K Recommendation"),
      recommended_by: { ...target, key_count: 6 as const },
    };
    const quickResponse: ManiaSimilarityRecommendationResponse = {
      ...recommendationResponse,
      groups: [
        { ...recommendationResponse.groups[0], results: quickResults },
        { ...recommendationResponse.groups[1], results: [quickSixKey] },
      ],
    };
    const fullResponse: ManiaSimilarityRecommendationResponse = {
      ...recommendationResponse,
      groups: [
        { ...recommendationResponse.groups[0], results: [...quickResults, ...freshResults] },
        { ...recommendationResponse.groups[1], results: [quickSixKey, freshSixKey] },
      ],
    };
    let resolveFull!: (response: ManiaSimilarityRecommendationResponse) => void;
    const deferredFull = new Promise<ManiaSimilarityRecommendationResponse>((resolve) => {
      resolveFull = resolve;
    });
    vi.spyOn(desktopApi, "recommendSimilarBeatmaps").mockImplementation((request) =>
      request.seed_limit === 5
        ? Promise.resolve({ ...quickResponse, kind: request.kind })
        : deferredFull,
    );

    renderPage();
    await user.click(await screen.findByRole("button", { name: "根据最近游玩推荐" }));
    expect(await screen.findByText("Reference - Quick Recommendation 1")).toBeInTheDocument();
    expect(screen.getByText("Reference - Quick Recommendation 3")).toBeInTheDocument();

    await act(async () => resolveFull(fullResponse));

    expect(await screen.findByText("Reference - Full Recommendation 1")).toBeInTheDocument();
    expect(screen.queryByText("Reference - Quick Recommendation 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /6K · 1/ }));
    expect(screen.getByText("Reference - Full 6K Recommendation")).toBeInTheDocument();
    expect(screen.queryByText("Reference - Quick 6K Recommendation")).not.toBeInTheDocument();
  });

  it("syncs a Mania deep link into the global mode and keeps unsupported modes empty", async () => {
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    const query = vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue(queryResponse);
    const view = renderPage("osu", "/online/similar?source=beatmap_id&value=3001&ruleset=mania");

    await waitFor(() => expect(screen.getByTestId("active-ruleset")).toHaveTextContent("mania"));
    await waitFor(() => expect(query).toHaveBeenCalledWith(expect.objectContaining({ ruleset: "mania" })));
    view.unmount();

    renderPage("taiko");
    expect(screen.getByText("osu!taiko 暂不支持相似谱面")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查找相似谱面" })).not.toBeInTheDocument();
  });

  it("syncs a Mania deep link introduced by search-only navigation after mount", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockImplementation(async (ruleset) => ruleset === "mania" ? maniaReady : osuReady);
    const query = vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue(queryResponse);
    renderPage("osu");
    await screen.findByText("索引已就绪");

    await user.click(screen.getByRole("button", { name: "打开 Mania search 深链" }));

    await waitFor(() => expect(screen.getByTestId("active-ruleset")).toHaveTextContent("mania"));
    await waitFor(() => expect(query).toHaveBeenCalledWith(expect.objectContaining({
      ruleset: "mania",
      source: { kind: "beatmap_id", value: "3001" },
    })));
    expect(query).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("similarity-location")).toHaveTextContent(/^\/online\/similar$/));

    await user.click(screen.getByRole("button", { name: "打开 Mania search 深链" }));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });

  it("keeps dataset-local results in today's history without opening an online page", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    const localResults = Array.from({ length: 5 }, (_, index) => ({
      ...maniaResult(2 ** 48 + 3700 + index, 4, `Local Recommendation ${index + 1}`),
      beatmapset_id: 2 ** 48 + 4100 + index,
      online_url: "",
      recommended_by: target,
    }));
    vi.spyOn(desktopApi, "recommendSimilarBeatmaps").mockImplementation(async (request) => ({
      ...recommendationResponse,
      kind: request.kind,
      groups: request.seed_limit === 5
        ? recommendationResponse.groups.map((group) => ({ ...group, results: [] }))
        : [
          { ...recommendationResponse.groups[0], results: localResults },
          recommendationResponse.groups[1],
          recommendationResponse.groups[2],
        ],
    }));

    renderPage();
    await user.click(await screen.findByRole("button", { name: "根据最近游玩推荐" }));
    expect(await screen.findByText("Reference - Local Recommendation 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载本批" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "今日推荐历史" }));
    const history = within(await screen.findByRole("dialog"));
    const entry = history.getByRole("button", { name: /Local Recommendation 1/ });
    expect(entry).toBeDisabled();
    expect(entry).toHaveTextContent("本地谱面");

    await user.click(entry);

    expect(history.getByRole("button", { name: /Local Recommendation 1/ })).toBeInTheDocument();
    expect(screen.getByTestId("similarity-location")).toHaveTextContent(/^\/online\/similar$/);
  });

  it("downloads only the online candidates of a Mania recommendation page", async () => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockResolvedValue(maniaReady);
    const onlineResults = [3801, 3802, 3803]
      .map((beatmapId, index) => ({ ...maniaResult(beatmapId, 4, `Online Recommendation ${index + 1}`), recommended_by: target }));
    const localResults = [3804, 3805]
      .map((beatmapId, index) => ({
        ...maniaResult(2 ** 48 + beatmapId, 4, `Local Recommendation ${index + 1}`),
        beatmapset_id: 2 ** 48 + beatmapId + 100,
        online_url: "",
        recommended_by: target,
      }));
    vi.spyOn(desktopApi, "recommendSimilarBeatmaps").mockImplementation(async (request) => ({
      ...recommendationResponse,
      kind: request.kind,
      groups: request.seed_limit === 5
        ? recommendationResponse.groups.map((group) => ({ ...group, results: [] }))
        : [
          { ...recommendationResponse.groups[0], results: [...onlineResults, ...localResults] },
          recommendationResponse.groups[1],
          recommendationResponse.groups[2],
        ],
    }));
    const download = vi.spyOn(desktopApi, "downloadOnlineBeatmapsets").mockResolvedValue({
      destination: "D:/downloads",
      total: 3,
      completed: 3,
      skipped: 0,
      failed: 0,
      cancelled: false,
      failures: [],
    });

    renderPage();
    await user.click(await screen.findByRole("button", { name: "根据最近游玩推荐" }));
    await screen.findByText("Reference - Local Recommendation 2");

    await user.click(screen.getByRole("button", { name: "下载本批" }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0][0].items.map((item) => item.beatmapset_id)).toEqual([3901, 3902, 3903]);
  });

  it("does not let an unconsumed deep link lock later global mode changes", async () => {
    const user = userEvent.setup();
    const getStatus = vi.spyOn(desktopApi, "getSimilarityIndexStatus").mockImplementation(async (ruleset) => ruleset === "osu" ? osuReady : {
        ruleset,
        state: "unconfigured",
        directory: null,
        message: `${ruleset} not configured`,
        record_count: null,
        analyzer_version: null,
        normalization_version: null,
        algorithm_id: null,
        data_cutoff_at: null,
        supports_dynamic_weighting: false,
        records_by_key_count: null,
      });
    const query = vi.spyOn(desktopApi, "querySimilarBeatmaps").mockResolvedValue(queryResponse);
    renderPage("osu", "/online/similar?source=beatmap_id&value=3001&ruleset=mania");
    await waitFor(() => expect(screen.getByTestId("active-ruleset")).toHaveTextContent("mania"));

    await user.click(screen.getByRole("button", { name: "切换 osu" }));
    await waitFor(() => expect(screen.getByTestId("active-ruleset")).toHaveTextContent("osu"));
    await waitFor(() => expect(getStatus).toHaveBeenCalledWith("osu"));
    await screen.findByText("索引已就绪");
    expect(query).not.toHaveBeenCalled();
  });
});
