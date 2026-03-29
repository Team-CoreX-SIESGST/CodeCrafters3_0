import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";

const COLORS = {
  bg: "#061019",
  panel: "#0b1722",
  panelSoft: "#0f1e2b",
  card: "#112332",
  text: "#f5fbff",
  sub: "#9ab3c8",
  line: "#1f3446",
  primary: "#00e87a",
  danger: "#ef4444",
  warn: "#f59e0b",
  accent: "#6aa9ff",
};

const HERO_STATS = [
  { value: "Passive", label: "Signal Collection" },
  { value: "6", label: "Cognitive States Tracked" },
  { value: "Real-time", label: "State Inference" },
];

const PROBLEMS = [
  "Cognitively overloaded",
  "Confused but still active",
  "Carrying attention residue",
  "Drifting toward a mistake",
];

const FEATURES = [
  {
    title: "Attention Residue Meter",
    description:
      "Detects when a user has switched tasks but still carries unresolved context from the previous one.",
  },
  {
    title: "Pre-Error Sentinel",
    description:
      "Surfaces interaction patterns that frequently precede mistakes, stalls, and cognitive breakdowns.",
  },
  {
    title: "Confusion Localization",
    description:
      "Pinpoints where users get stuck across pages, tools, and artifacts by reading hesitation and reversals.",
  },
  {
    title: "Flow Integrity Tracking",
    description:
      "Separates deep-focus windows from fragmented attention states so interruptions can be timed intelligently.",
  },
  {
    title: "Recovery Capsule",
    description:
      "Preserves context at interruption points and surfaces the best next step when the user returns.",
  },
  {
    title: "Productive Struggle Engine",
    description:
      "Differentiates healthy cognitive effort from harmful confusion so support is offered at the right moment.",
  },
];

const HOW_IT_WORKS = [
  {
    num: "01",
    title: "Observe",
    body: "Typing rhythm, dwell duration, movement, hesitation, and navigation reversals are captured passively.",
  },
  {
    num: "02",
    title: "Infer",
    body: "Signals are mapped into focus depth, confusion risk, fatigue drift, attention residue, and interruptibility.",
  },
  {
    num: "03",
    title: "Predict",
    body: "Pre-error signatures and overload trajectories are detected before they become visible failure.",
  },
  {
    num: "04",
    title: "Assist",
    body: "Recovery capsules and interruption timing support the user when cognitive friction starts to rise.",
  },
];

const IMPACT_STATS = [
  { value: "87%", label: "Confusion hotspots surfaced" },
  { value: "3x", label: "Faster context recovery" },
  { value: "62%", label: "Risky transitions flagged early" },
  { value: "91%", label: "Pre-error moments identified" },
];

const SAMPLE_DASHBOARD = {
  summary: {
    snapshotCount: 128,
    latestState: "focused",
    topState: "focused",
    avgFocusDepth: 0.72,
    avgConfusionRisk: 0.28,
    avgFatigueRisk: 0.18,
    avgInterruptibility: 0.41,
    deepFocusRate: 19,
    harmfulConfusionRate: 11,
    fatigueRate: 9,
  },
  live: {
    current: {
      stateLabel: "focused",
      activeApp: "Visual Studio Code",
      confidence: 0.84,
      scores: {
        focus_depth: 0.74,
        confusion_risk: 0.22,
        fatigue_risk: 0.16,
        interruptibility: 0.33,
      },
    },
    graph: {
      stats: {
        nodeCount: 42,
        relationCount: 76,
        dbNodeCount: 42,
        dbRelationCount: 76,
        nodeTypes: {
          user: 1,
          session: 1,
          app: 6,
          window: 8,
          artifact: 7,
          state: 5,
          classifier_state: 3,
          cursor_state: 4,
          expression: 3,
          snapshot: 4,
        },
      },
    },
  },
  analytics: {
    scoreAverages: [
      { key: "focus_depth", label: "Focus depth", value: 0.72 },
      { key: "attention_residue", label: "Attention residue", value: 0.31 },
      { key: "pre_error_risk", label: "Pre-error risk", value: 0.24 },
      { key: "confusion_risk", label: "Confusion risk", value: 0.28 },
      { key: "fatigue_risk", label: "Fatigue risk", value: 0.18 },
      { key: "interruptibility", label: "Interruptibility", value: 0.41 },
    ],
    scoreTimeline: [
      { timestamp: "09:00", stateLabel: "focused", focusDepth: 0.75, confusionRisk: 0.18, fatigueRisk: 0.11, interruptibility: 0.29 },
      { timestamp: "09:05", stateLabel: "deep_focus", focusDepth: 0.82, confusionRisk: 0.14, fatigueRisk: 0.10, interruptibility: 0.23 },
      { timestamp: "09:10", stateLabel: "focused", focusDepth: 0.71, confusionRisk: 0.22, fatigueRisk: 0.13, interruptibility: 0.31 },
      { timestamp: "09:15", stateLabel: "confused", focusDepth: 0.49, confusionRisk: 0.54, fatigueRisk: 0.19, interruptibility: 0.48 },
      { timestamp: "09:20", stateLabel: "focused", focusDepth: 0.69, confusionRisk: 0.26, fatigueRisk: 0.18, interruptibility: 0.37 },
      { timestamp: "09:25", stateLabel: "fatigued", focusDepth: 0.42, confusionRisk: 0.31, fatigueRisk: 0.57, interruptibility: 0.62 },
      { timestamp: "09:30", stateLabel: "focused", focusDepth: 0.74, confusionRisk: 0.21, fatigueRisk: 0.18, interruptibility: 0.34 },
      { timestamp: "09:35", stateLabel: "deep_focus", focusDepth: 0.84, confusionRisk: 0.12, fatigueRisk: 0.16, interruptibility: 0.22 },
    ],
    stateDistribution: [
      { label: "focused", percentage: 48, count: 61 },
      { label: "deep_focus", percentage: 19, count: 24 },
      { label: "confused", percentage: 18, count: 23 },
      { label: "fatigued", percentage: 9, count: 12 },
      { label: "ideal", percentage: 6, count: 8 },
    ],
    stateTransitions: [
      { from: "focused", to: "deep_focus", count: 18 },
      { from: "deep_focus", to: "focused", count: 16 },
      { from: "focused", to: "confused", count: 11 },
      { from: "confused", to: "focused", count: 9 },
      { from: "focused", to: "fatigued", count: 5 },
      { from: "fatigued", to: "focused", count: 4 },
    ],
    appBreakdown: [
      { app: "Visual Studio Code", share: 42, avgFocus: 0.78, avgConfusion: 0.18, avgFatigue: 0.14 },
      { app: "Chrome", share: 27, avgFocus: 0.52, avgConfusion: 0.34, avgFatigue: 0.21 },
      { app: "PowerPoint", share: 16, avgFocus: 0.48, avgConfusion: 0.37, avgFatigue: 0.25 },
      { app: "WhatsApp", share: 15, avgFocus: 0.21, avgConfusion: 0.17, avgFatigue: 0.08 },
    ],
    frictionHotspots: [
      { artifactId: "1", artifactLabel: "dashboard/page.tsx", frictionScore: 0.71, visits: 9, revisits: 5 },
      { artifactId: "2", artifactLabel: "overlay.py", frictionScore: 0.64, visits: 7, revisits: 4 },
      { artifactId: "3", artifactLabel: "HeroSection.jsx", frictionScore: 0.48, visits: 4, revisits: 2 },
    ],
    scoreExtremes: {
      highestFocus: { timestamp: "09:35", stateLabel: "deep_focus", focusDepth: 0.84, confusionRisk: 0.12, fatigueRisk: 0.16, interruptibility: 0.22 },
      highestConfusion: { timestamp: "09:15", stateLabel: "confused", focusDepth: 0.49, confusionRisk: 0.54, fatigueRisk: 0.19, interruptibility: 0.48 },
      highestFatigue: { timestamp: "09:25", stateLabel: "fatigued", focusDepth: 0.42, confusionRisk: 0.31, fatigueRisk: 0.57, interruptibility: 0.62 },
    },
    alertTotals: {
      attentionResidue: 7,
      preError: 5,
      fatigue: 3,
      confusionEpisodes: 4,
      handoffCapsules: 2,
    },
  },
};

function resolveApiUrl() {
  const configured =
    process.env.EXPO_PUBLIC_GRAPH_API_URL ||
    process.env.EXPO_PUBLIC_GRAPH_API_BASE_URL ||
    "http://192.168.12.120:5003";

  const trimmed = String(configured).trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/cognitive/dashboard")) {
    return trimmed;
  }
  return `${trimmed}/api/cognitive/dashboard`;
}

const API_URL = resolveApiUrl();

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function pretty(label) {
  return String(label || "-").replace(/_/g, " ");
}

function scoreColor(value) {
  if (value >= 0.65) return COLORS.primary;
  if (value >= 0.4) return COLORS.warn;
  return COLORS.danger;
}

function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}
      activeOpacity={0.85}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ eyebrow, title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ProgressBar({ value, color }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(value * 100, 6)}%`, backgroundColor: color }]} />
    </View>
  );
}

function MetricPill({ label, value, color }) {
  return (
    <View style={[styles.metricPill, { borderColor: `${color}55`, backgroundColor: `${color}18` }]}>
      <Text style={[styles.metricPillValue, { color }]}>{value}</Text>
      <Text style={styles.metricPillLabel}>{label}</Text>
    </View>
  );
}

function TimelineMiniChart({ timeline }) {
  const focusValues = (timeline || []).slice(-8);
  if (!focusValues.length) {
    return <Text style={styles.featureBody}>No timeline data yet.</Text>;
  }
  return (
    <View style={styles.timelineWrap}>
      <View style={styles.timelineBars}>
        {focusValues.map((point, index) => (
          <View key={`${point.timestamp || index}`} style={styles.timelineColumn}>
            <View style={styles.timelineTrack}>
              <View style={[styles.timelineFill, { height: `${Math.max((point.focusDepth || 0) * 100, 10)}%` }]} />
            </View>
            <Text style={styles.timelineLabel}>{String(point.timestamp || index).slice(-5)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.timelineLegend}>Focus-depth movement over recent snapshots</Text>
    </View>
  );
}

function HomeScreen({ onGoDashboard }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <Text style={styles.heroTag}>COGNITIVE OBSERVABILITY FOR DIGITAL WORK</Text>
        <Text style={styles.heroTitle}>
          See cognitive friction{"\n"}
          <Text style={styles.heroTitleAccent}>before</Text> it becomes a mistake.
        </Text>
        <Text style={styles.heroBody}>
          NeuroTrace transforms interaction patterns into explainable signals of focus,
          confusion, fatigue, and recovery need.
        </Text>

        <View style={styles.heroActions}>
          <TouchableOpacity onPress={onGoDashboard} style={styles.primaryButton} activeOpacity={0.9}>
            <Text style={styles.primaryButtonText}>Open Dashboard</Text>
          </TouchableOpacity>
          <View style={styles.secondaryPill}>
            <Text style={styles.secondaryPillText}>Mobile Product Demo</Text>
          </View>
        </View>

        <View style={styles.heroStatsRow}>
          {HERO_STATS.map((item) => (
            <View key={item.label} style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{item.value}</Text>
              <Text style={styles.heroStatLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Section eyebrow="THE PROBLEM" title="Every session looks productive. Until the mistake appears.">
        <Text style={styles.sectionBody}>
          Most systems track visible productivity, but they stay blind to overload,
          confusion, attention residue, and the silent drift toward preventable errors.
        </Text>
        <View style={styles.listCard}>
          <Text style={styles.listCardTitle}>Current tools cannot see</Text>
          {PROBLEMS.map((item) => (
            <View key={item} style={styles.listRow}>
              <Text style={styles.listRowText}>{item}</Text>
              <Text style={styles.listRowState}>invisible</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section eyebrow="FEATURES" title="Six signals. One mobile-ready product story.">
        {FEATURES.map((feature) => (
          <View key={feature.title} style={styles.featureCard}>
            <Text style={styles.featureTitle}>{feature.title}</Text>
            <Text style={styles.featureBody}>{feature.description}</Text>
          </View>
        ))}
      </Section>

      <Section eyebrow="HOW IT WORKS" title="From interaction patterns to explainable cognitive state.">
        {HOW_IT_WORKS.map((step) => (
          <View key={step.num} style={styles.stepCard}>
            <Text style={styles.stepNumber}>{step.num}</Text>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
            </View>
          </View>
        ))}
      </Section>

      <Section eyebrow="OUTCOME" title="Why users would actually use this">
        <Text style={styles.sectionBody}>
          The product helps users protect deep work, detect confusion earlier, and notice fatigue
          before it turns into repeated mistakes. It improves productivity by making the system
          responsive to real cognitive state instead of only visible clicks and task completion.
        </Text>
        <View style={styles.statsGrid}>
          {IMPACT_STATS.map((item) => (
            <View key={item.label} style={styles.impactCard}>
              <Text style={styles.impactValue}>{item.value}</Text>
              <Text style={styles.impactLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}

function DashboardScreen() {
  const [data, setData] = useState(SAMPLE_DASHBOARD);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("Unable to load dashboard");
      const payload = await response.json();
      setData(payload);
      setError("");
    } catch (err) {
      setError("Showing sample dashboard data. Connect backend API to see live values.");
      setData(SAMPLE_DASHBOARD);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(false);
  }, []);

  const summary = data?.summary || SAMPLE_DASHBOARD.summary;
  const live = data?.live?.current || SAMPLE_DASHBOARD.live.current;
  const analytics = data?.analytics || SAMPLE_DASHBOARD.analytics;
  const graph = data?.live?.graph || SAMPLE_DASHBOARD.live.graph;

  const kpis = useMemo(
    () => [
      { label: "Focus", value: pct(summary.avgFocusDepth), color: COLORS.primary },
      { label: "Confusion", value: pct(summary.avgConfusionRisk), color: COLORS.danger },
      { label: "Fatigue", value: pct(summary.avgFatigueRisk), color: COLORS.warn },
      { label: "Interruptibility", value: pct(summary.avgInterruptibility), color: COLORS.accent },
    ],
    [summary]
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#ffffff" />}
    >
      <View style={styles.heroCard}>
        <Text style={styles.heroTag}>MOBILE COGNITIVE DASHBOARD</Text>
        <Text style={styles.heroTitle}>Live observer view for{`\n`}NeuroTrace.</Text>
        <Text style={styles.heroBody}>
          This mobile app mirrors the web dashboard with the same cognitive data blocks,
          adapted into a mobile-friendly layout.
        </Text>
        {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 8 }} /> : null}
        {error ? <Text style={styles.warningText}>{error}</Text> : null}
        <View style={styles.metricPillRow}>
          <MetricPill label="Snapshots" value={String(summary.snapshotCount || 0)} color={COLORS.primary} />
          <MetricPill label="Top state" value={pretty(summary.topState)} color={COLORS.accent} />
          <MetricPill label="Latest state" value={pretty(summary.latestState)} color={COLORS.warn} />
        </View>
      </View>

      <Section eyebrow="LIVE STATE" title={pretty(live.stateLabel)}>
        <View style={styles.liveStateRow}>
          <View style={[styles.liveBadge, { backgroundColor: COLORS.primary + "22", borderColor: COLORS.primary + "55" }]}>
            <Text style={[styles.liveBadgeText, { color: COLORS.primary }]}>
              {Math.round((live.confidence || 0) * 100)}% confidence
            </Text>
          </View>
          <Text style={styles.liveApp}>App: {live.activeApp || "-"}</Text>
        </View>
        <View style={styles.kpiGrid}>
          {kpis.map((item) => (
            <View key={item.label} style={styles.kpiCard}>
              <Text style={[styles.kpiValue, { color: item.color }]}>{item.value}</Text>
              <Text style={styles.kpiLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section eyebrow="ALERT TOTALS" title="Observer alerts and support events">
        <View style={styles.metricPillRow}>
          <MetricPill label="Residue" value={String(analytics.alertTotals?.attentionResidue || 0)} color={COLORS.warn} />
          <MetricPill label="Pre-error" value={String(analytics.alertTotals?.preError || 0)} color={COLORS.danger} />
          <MetricPill label="Fatigue" value={String(analytics.alertTotals?.fatigue || 0)} color={COLORS.warn} />
          <MetricPill label="Confusion ep." value={String(analytics.alertTotals?.confusionEpisodes || 0)} color={COLORS.accent} />
          <MetricPill label="Handoffs" value={String(analytics.alertTotals?.handoffCapsules || 0)} color={COLORS.sub} />
        </View>
      </Section>

      <Section eyebrow="SIGNAL TIMELINE" title="Score movement over time">
        <TimelineMiniChart timeline={analytics.scoreTimeline || []} />
      </Section>

      <Section eyebrow="AVERAGE SCORES" title="Core cognitive scores">
        {analytics.scoreAverages.map((score) => (
          <View key={score.key} style={styles.metricRow}>
            <View style={styles.metricHeader}>
              <Text style={styles.metricLabel}>{score.label}</Text>
              <Text style={[styles.metricValue, { color: scoreColor(score.value) }]}>{pct(score.value)}</Text>
            </View>
            <ProgressBar value={score.value} color={scoreColor(score.value)} />
          </View>
        ))}
      </Section>

      <Section eyebrow="STATE DISTRIBUTION" title="How the session is distributed">
        {analytics.stateDistribution.map((state) => (
          <View key={state.label} style={styles.metricRow}>
            <View style={styles.metricHeader}>
              <Text style={styles.metricLabel}>{pretty(state.label)}</Text>
              <Text style={styles.metricValue}>{state.percentage}% ({state.count})</Text>
            </View>
            <ProgressBar value={state.percentage / 100} color={COLORS.accent} />
          </View>
        ))}
      </Section>

      <Section eyebrow="STATE TRANSITIONS" title="How states flow into each other">
        {(analytics.stateTransitions || []).map((transition, index) => (
          <View key={`${transition.from}-${transition.to}-${index}`} style={styles.metricRow}>
            <View style={styles.metricHeader}>
              <Text style={styles.metricLabel}>
                {pretty(transition.from)} → {pretty(transition.to)}
              </Text>
              <Text style={styles.metricValue}>{transition.count}</Text>
            </View>
            <ProgressBar value={Math.min((transition.count || 0) / 20, 1)} color={COLORS.accent} />
          </View>
        ))}
      </Section>

      <Section eyebrow="GRAPH CONTEXT" title="Observer graph and node inventory">
        <View style={styles.metricPillRow}>
          <MetricPill label="Nodes" value={String(graph?.stats?.nodeCount || 0)} color={COLORS.primary} />
          <MetricPill label="Links" value={String(graph?.stats?.relationCount || 0)} color={COLORS.accent} />
          <MetricPill label="DB nodes" value={String(graph?.stats?.dbNodeCount || 0)} color={COLORS.warn} />
          <MetricPill label="DB links" value={String(graph?.stats?.dbRelationCount || 0)} color={COLORS.danger} />
        </View>
        <View style={styles.nodePillWrap}>
          {Object.entries(graph?.stats?.nodeTypes || {}).map(([type, count]) => (
            <View key={type} style={styles.nodePill}>
              <Text style={styles.nodePillType}>{type}</Text>
              <Text style={styles.nodePillCount}>{count}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section eyebrow="APP BREAKDOWN" title="Where cognitive load is happening">
        {analytics.appBreakdown.map((entry) => (
          <View key={entry.app} style={styles.featureCard}>
            <Text style={styles.featureTitle}>{entry.app}</Text>
            <Text style={styles.featureBody}>{entry.share}% of tracked time</Text>
            <View style={styles.metricStack}>
              <Text style={styles.metricTiny}>Focus {Math.round(entry.avgFocus * 100)}%</Text>
              <ProgressBar value={entry.avgFocus} color={COLORS.primary} />
              <Text style={styles.metricTiny}>Confusion {Math.round(entry.avgConfusion * 100)}%</Text>
              <ProgressBar value={entry.avgConfusion} color={COLORS.danger} />
              <Text style={styles.metricTiny}>Fatigue {Math.round(entry.avgFatigue * 100)}%</Text>
              <ProgressBar value={entry.avgFatigue} color={COLORS.warn} />
            </View>
          </View>
        ))}
      </Section>

      <Section eyebrow="FRICTION HOTSPOTS" title="Most difficult artifacts">
        {analytics.frictionHotspots.map((spot) => (
          <View key={spot.artifactId} style={styles.featureCard}>
            <View style={styles.metricHeader}>
              <Text style={[styles.featureTitle, { flex: 1 }]}>{spot.artifactLabel}</Text>
              <Text style={[styles.metricValue, { color: COLORS.warn }]}>{Math.round(spot.frictionScore * 100)}%</Text>
            </View>
            <ProgressBar value={spot.frictionScore} color={COLORS.warn} />
            <Text style={styles.featureBody}>Visits {spot.visits} · Revisits {spot.revisits}</Text>
          </View>
        ))}
      </Section>

      <Section eyebrow="SCORE EXTREMES" title="Peak cognitive moments in the data">
        {[
          { label: "Highest Focus", point: analytics.scoreExtremes?.highestFocus, field: "focusDepth", color: COLORS.primary },
          { label: "Highest Confusion", point: analytics.scoreExtremes?.highestConfusion, field: "confusionRisk", color: COLORS.danger },
          { label: "Highest Fatigue", point: analytics.scoreExtremes?.highestFatigue, field: "fatigueRisk", color: COLORS.warn },
        ].map((item) => (
          <View key={item.label} style={styles.featureCard}>
            <View style={styles.metricHeader}>
              <Text style={styles.featureTitle}>{item.label}</Text>
              <Text style={[styles.metricValue, { color: item.color }]}>
                {pct(item.point?.[item.field] || 0)}
              </Text>
            </View>
            <Text style={styles.featureBody}>
              {pretty(item.point?.stateLabel)} · {item.point?.timestamp || "-"}
            </Text>
            <ProgressBar value={item.point?.[item.field] || 0} color={item.color} />
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ExpoStatusBar style="light" />

      <View style={styles.appShell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>NeuroTrace</Text>
            <Text style={styles.brandSub}>Mobile companion app</Text>
          </View>
          <View style={styles.tabs}>
            <TabButton label="Home" active={screen === "home"} onPress={() => setScreen("home")} />
            <TabButton label="Dashboard" active={screen === "dashboard"} onPress={() => setScreen("dashboard")} />
          </View>
        </View>

        {screen === "home" ? <HomeScreen onGoDashboard={() => setScreen("dashboard")} /> : <DashboardScreen />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  appShell: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    backgroundColor: "#08131d",
  },
  brand: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  brandSub: {
    color: COLORS.sub,
    fontSize: 12,
    marginTop: 2,
  },
  tabs: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  tabButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  tabButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tabText: {
    color: COLORS.sub,
    fontWeight: "600",
    fontSize: 13,
  },
  tabTextActive: {
    color: "#04110a",
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 36,
    gap: 18,
  },
  heroCard: {
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 28,
    padding: 22,
  },
  heroTag: {
    color: COLORS.primary,
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "700",
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "800",
    marginTop: 12,
  },
  heroTitleAccent: {
    color: COLORS.primary,
    fontStyle: "italic",
  },
  heroBody: {
    color: COLORS.sub,
    fontSize: 15,
    lineHeight: 24,
    marginTop: 14,
  },
  heroActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 18,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: "#04110a",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryPill: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.panelSoft,
  },
  secondaryPillText: {
    color: COLORS.sub,
    fontSize: 13,
    fontWeight: "600",
  },
  heroStatsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 22,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 18,
    gap: 10,
  },
  heroStat: {
    minWidth: "30%",
    flex: 1,
  },
  heroStatValue: {
    color: COLORS.primary,
    fontSize: 22,
    fontWeight: "800",
  },
  heroStatLabel: {
    color: COLORS.sub,
    fontSize: 11,
    marginTop: 4,
  },
  section: {
    backgroundColor: COLORS.panelSoft,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 18,
    gap: 14,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: "700",
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "700",
  },
  sectionBody: {
    color: COLORS.sub,
    fontSize: 15,
    lineHeight: 24,
  },
  listCard: {
    borderRadius: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 14,
    gap: 4,
  },
  listCardTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingVertical: 11,
    gap: 10,
  },
  listRowText: {
    color: COLORS.text,
    fontSize: 14,
    flex: 1,
  },
  listRowState: {
    color: COLORS.danger,
    fontSize: 12,
    textTransform: "uppercase",
  },
  featureCard: {
    borderRadius: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 14,
    gap: 8,
  },
  featureTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "700",
  },
  featureBody: {
    color: COLORS.sub,
    fontSize: 14,
    lineHeight: 22,
  },
  stepCard: {
    flexDirection: "row",
    gap: 14,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 14,
  },
  stepNumber: {
    color: COLORS.primary,
    fontSize: 24,
    fontWeight: "800",
    width: 42,
  },
  stepContent: {
    flex: 1,
    gap: 6,
  },
  stepTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "700",
  },
  stepBody: {
    color: COLORS.sub,
    fontSize: 14,
    lineHeight: 22,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  impactCard: {
    width: "48%",
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 18,
    padding: 14,
  },
  impactValue: {
    color: COLORS.primary,
    fontSize: 24,
    fontWeight: "800",
  },
  impactLabel: {
    color: COLORS.sub,
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },
  warningText: {
    color: COLORS.warn,
    fontSize: 13,
    marginTop: 12,
    lineHeight: 20,
  },
  liveStateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  liveBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  liveBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  liveApp: {
    color: COLORS.sub,
    fontSize: 14,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  metricPill: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: "30%",
  },
  metricPillValue: {
    fontSize: 14,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  metricPillLabel: {
    color: COLORS.sub,
    fontSize: 11,
    marginTop: 3,
  },
  kpiCard: {
    width: "48%",
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 18,
    padding: 14,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: "800",
  },
  kpiLabel: {
    color: COLORS.sub,
    fontSize: 12,
    marginTop: 4,
  },
  metricRow: {
    gap: 8,
  },
  metricHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  metricLabel: {
    color: COLORS.text,
    fontSize: 14,
    flex: 1,
  },
  metricValue: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "700",
  },
  progressTrack: {
    height: 10,
    backgroundColor: "#1a2c3a",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  timelineWrap: {
    gap: 10,
  },
  timelineBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    height: 160,
  },
  timelineColumn: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  timelineTrack: {
    width: "100%",
    flex: 1,
    borderRadius: 999,
    backgroundColor: "#1a2c3a",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  timelineFill: {
    width: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    minHeight: 8,
  },
  timelineLabel: {
    color: COLORS.sub,
    fontSize: 10,
  },
  timelineLegend: {
    color: COLORS.sub,
    fontSize: 12,
  },
  metricStack: {
    gap: 8,
    marginTop: 6,
  },
  metricTiny: {
    color: COLORS.sub,
    fontSize: 12,
  },
  nodePillWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  nodePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  nodePillType: {
    color: COLORS.text,
    fontSize: 12,
    textTransform: "uppercase",
  },
  nodePillCount: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "700",
  },
});
