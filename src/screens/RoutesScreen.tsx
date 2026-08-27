import {
  ArrowLeftRight,
  Award,
  CalendarDays,
  Flag,
  Gauge,
  Layers,
  Loader2,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Route as RouteIcon,
  Search,
  Square,
  Target,
  Timer,
  Trophy,
  X,
} from "lucide-react";
import L from "leaflet";
import { ChallengeIcon } from "../components/ChallengeIcon";
import { VectorBasemap } from "../components/VectorBasemap";
import { useBrandBand } from "../hooks/useBrandBand";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, ScaleControl, TileLayer, useMap } from "react-leaflet";
import { BeeMark } from "../components/Wordmark";
import { MANILA_CENTER } from "../config/constants";
import { LocationService } from "../services/LocationService";
import { snapToRoads } from "../services/MapMatchService";
import { BAND_COLOUR, earningsGrid, findStops, heatColour, speedSegments } from "../services/RouteInsights";
import { describeStep, directionsBetween, scoreAgainstHistory, type Directions } from "../services/DirectionsService";
import { distanceKm, searchPlaces, type PlaceHit } from "../services/PlacesService";
import { RECENT_WINDOW, SupabaseService } from "../services/SupabaseService";
import { useLangStore, useT } from "../i18n";
import { countryToCurrency, reverseGeocodeCountry } from "../i18n/region";
import { useAuthStore } from "../stores/useAuthStore";
import { useChatStore } from "../stores/useChatStore";
import { connectionFor, useCommunityStore } from "../stores/useCommunityStore";
import { useLocationStore } from "../stores/useLocationStore";
import { useProfileStore } from "../stores/useProfileStore";
import type { Challenge, ChallengeMetric, LocationPoint } from "../types";
import { currency, duration, initials, km, timeAgo, weeklyGoalFrom } from "../utils/format";
import { getWorkApp } from "../utils/workApps";

/*
 * Tiles.
 *
 * This shipped pointing at CARTO's basemap CDN with no key, and CARTO stamps a
 * sample of tiles with "API KEY REQUIRED · carto.com/basemaps/apikey" baked
 * into the image. Not a rate limit and not an error — a working map with an
 * advert printed across it, which every driver would have seen.
 *
 * OpenStreetMap's own tiles need no key and carry no watermark, so the map is
 * clean today. That is not the end of it: OSM's tile usage policy is for
 * development and light use, and explicitly not for a product with real users.
 * Before this app has any, VITE_TILE_URL must point at a provider with a key —
 * MapTiler and Stadia both have free tiers, and a self-hosted Protomaps file
 * removes the per-request cost entirely and is the right answer if offline maps
 * are wanted later.
 *
 * It reads from the environment so that swap is a config change, not a code
 * change, and so the key never lands in the repository.
 */
const TILES = {
  standard: {
    url: import.meta.env.VITE_TILE_URL ||
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: (import.meta.env.VITE_TILE_SUBDOMAINS as string) || "",
    attribution: (import.meta.env.VITE_TILE_ATTRIBUTION as string) ||
      "&copy; OpenStreetMap contributors",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: "",
    attribution: "&copy; Esri",
  },
} as const;

/* One label per map mode, so the switch and its aria-label cannot drift. */
const MODE_KEY = {
  me: "sv_modeMe",
  earnings: "sv_modeEarnings",
} as const;

type MapStyle = keyof typeof TILES;
/**
  * Three pages, not two.
  *
  * "Friends" used to be one of three states of a cycling switch over the
  * driver's own map, which meant it inherited a screen built for a different
  * job: a record sheet, a date picker for YOUR history, a speed key for YOUR
  * path. None of that means anything when you are looking at other people.
  *
  * Split, each page can have the controls its own question needs — and neither
  * has to carry the other's.
  */
type StravaView = "maps" | "friends" | "challenges";

/** One geocoded place. The shape lives with the search service now. */
type SearchHit = PlaceHit;

// Rough squared-degree distance — only used to rank search hits by nearness,
// so it never needs real great-circle accuracy.
/**
 * Escapes text destined for a Leaflet divIcon's HTML string.
 *
 * Marker HTML is built by concatenation, not by React, so nothing sanitises it
 * on the way in. A driver's name is another person's typed input, and it is
 * shown on every other driver's map.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First name only — a full name overruns the callout on a phone-width map. */
function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.length > 14 ? `${first.slice(0, 13)}…` : first;
}

export function RoutesScreen() {
  useBrandBand("routes");
  const t = useT();
  const currentLocation = useLocationStore((state) => state.currentLocation);
  const route = useLocationStore((state) => state.route);
  const isTracking = useLocationStore((state) => state.isTracking);
  const totalDistanceKm = useLocationStore((state) => state.totalDistanceKm);
  const elapsedMinutes = useLocationStore((state) => state.elapsedMinutes);
  const startTracking = useLocationStore((state) => state.startTracking);
  const stopTracking = useLocationStore((state) => state.stopTracking);
  const workers = useCommunityStore((state) => state.workers);
  const challenges = useCommunityStore((state) => state.challenges);
  const toggleChallenge = useCommunityStore((state) => state.toggleChallenge);
  const loadCloudCommunity = useCommunityStore((state) => state.loadCloudCommunity);
  const activeApp = useProfileStore((state) => state.activeApp);
  const dailyGoal = useProfileStore((state) => state.dailyGoal);
  const baseRate = useProfileStore((state) => state.baseRate);
  const app = getWorkApp(activeApp);
  const user = useAuthStore((state) => state.user);
  const weekDistanceKm = useLocationStore((state) => state.weekDistanceKm);
  const weekEarnings = useLocationStore((state) => state.weekEarnings);
  const chatMessages = useChatStore((state) => state.messages);

  // Real challenge progress from this week's actual activity.
  const weekStart = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
  }, []);
  const myWeekMessages = useMemo(
    () => chatMessages.filter((m) => m.senderId === user?.id && m.createdAt >= weekStart).length,
    [chatMessages, user?.id, weekStart],
  );
  // Built-in challenges map their metric from a known id; custom ones carry it
  // explicitly. Either way progress comes from this week's real activity.
  const metricOf = (challenge: Challenge): ChallengeMetric | undefined =>
    challenge.metric ??
    (challenge.id === "challenge_distance"
      ? "distance"
      : challenge.id === "challenge_earn"
        ? "earnings"
        : challenge.id === "challenge_social"
          ? "social"
          : undefined);
  // The built-in earnings challenge shipped a fixed 2500 target — sensible as
  // ₱2,500/week, impossible as $2,500/week (~3,570 km). Derive it from the
  // driver's own daily goal instead. Custom challenges keep their own target.
  const targetOf = (challenge: Challenge): number =>
    challenge.id === "challenge_earn"
      ? weeklyGoalFrom(dailyGoal)
      : challenge.target;

  // Seeded earnings challenges carry an {amount} token so the goal renders in
  // the driver's own currency instead of a hardcoded peso figure.
  const titleOf = (challenge: Challenge): string =>
    challenge.title.includes("{amount}")
      ? challenge.title.replace("{amount}", currency(targetOf(challenge)))
      : challenge.title;
  const progressFor = (challenge: Challenge): number => {
    const target = targetOf(challenge);
    switch (metricOf(challenge)) {
      case "distance":
        return Math.min(target, weekDistanceKm);
      case "earnings":
        return Math.min(target, weekEarnings);
      case "social":
        return Math.min(target, myWeekMessages);
      default:
        return challenge.progress;
    }
  };

  const [view, setView] = useState<StravaView>("maps");
  const [map, setMap] = useState<L.Map | null>(null);

  /**
   * The record sheet's height, published to CSS as --sv-sheet-h.
   *
   * The map controls were centred vertically (top: 46%) and knew nothing about
   * the sheet below them, so on a shorter viewport the last button in the rail
   * — "Change map layer" — ended up 24px underneath it and could not be
   * tapped at all. Measuring rather than hardcoding, because the sheet grows
   * with its content: "Ready to record" and a live recording with pace and
   * splits are not the same height, and neither is a phone with a home
   * indicator.
   *
   * Same approach the header already uses for --band-pull.
   */
  /**
   * Whether the bottom sheet is collapsed to its handle.
   *
   * It has always had a grip — the little bar that every sheet on every phone
   * means "drag me" — and it did nothing. That is worse than having no handle:
   * it promises an interaction and then refuses it, and the driver is left with
   * a third of the map permanently covered with no way to see under it.
   *
   * Drag it down or tap the handle to collapse; either brings it back.
   */
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const dragRef = useRef<{ y: number; collapsed: boolean } | null>(null);

  /** Drag on the handle. Pointer events, so one path covers finger and mouse. */
  const gripHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      dragRef.current = { y: e.clientY, collapsed: sheetCollapsed };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      // 28px before it commits, so a tap is not read as a tiny drag.
      const dy = e.clientY - start.y;
      if (dy > 28) setSheetCollapsed(true);
      else if (dy < -28) setSheetCollapsed(false);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const start = dragRef.current;
      dragRef.current = null;
      // Barely moved? Treat it as a tap and toggle — the handle should work
      // for someone who taps it as well as someone who drags it.
      if (start && Math.abs(e.clientY - start.y) <= 28) setSheetCollapsed((v) => !v);
    },
    onPointerCancel: () => { dragRef.current = null; },
  };

  /**
   * The control rail's height, published as --sv-rail-h.
   *
   * The layer button sits above the rail, and I positioned it by adding up
   * what I thought the rail contained — 44 + 12 + 44. The zoom control is a
   * pair in one box and measures 89, not 44, so the rail is 145 tall and the
   * button landed inside it. Measuring beats arithmetic about somebody else's
   * component, and it keeps working if a control is ever added or removed.
   */
  const railRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--sv-rail-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--sv-rail-h");
    };
  }, [view]);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        "--sv-sheet-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--sv-sheet-h");
    };
  }, [view]);
  const [mapStyle, setMapStyle] = useState<MapStyle>("standard");

  // Location search (OpenStreetMap Nominatim — free, no API key).
  const [locQuery, setLocQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searchPin, setSearchPin] = useState<SearchHit | null>(null);
  // While recording, the map auto-follows the driver. A search would be yanked
  // back on the next GPS fix, so pause following until they re-centre on themselves.
  const [followPaused, setFollowPaused] = useState(false);

  const searchLocation = async (event: FormEvent) => {
    event.preventDefault();
    const q = locQuery.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchMsg("");
    setResults([]);
    try {
      // Provider and ranking both live in PlacesService now — this used to be
      // ninety lines of fetching, de-duplicating and sorting inside the
      // component, which made "swap the geocoder" a rewrite of a screen.
      const hits = await searchPlaces(q, currentLocation);
      if (!hits.length) {
        setSearchMsg(t("sv_searchNoResult"));
      } else if (hits.length === 1) {
        // A single confident match jumps straight there; otherwise let the
        // driver pick, since "Jollibee" legitimately matches many branches.
        selectResult(hits[0]);
      } else {
        setResults(hits);
      }
    } catch {
      setSearchMsg(t("sv_searchFailed"));
    } finally {
      setSearching(false);
    }
  };

  const selectResult = (hit: SearchHit) => {
    setFollowPaused(true);
    setSearchPin(hit);
    setResults([]);
    setLocQuery(hit.label);
    map?.setView([hit.lat, hit.lng], 16, { animate: true });
  };

  /**
   * Leaving a page drops what belonged to it.
   *
   * Maps and Friends share one Leaflet instance, so a destination searched on
   * Maps stayed pinned — with its route line, its turn list and its ETA — when
   * you switched to Friends, where it means nothing and covers the people you
   * came to look at. The search box kept the text too, so the Friends page
   * opened mid-query for somewhere you had already been.
   *
   * Cleared on the way out rather than the way in, so neither page has to know
   * what the other left behind.
   */
  useEffect(() => {
    setLocQuery("");
    setResults([]);
    setSearchMsg("");
    setSearchPin(null);
    setRouteOptions([]);
    setChosenRoute(0);
    setPinnedHere(false);
  }, [view]);

  const clearSearch = () => {
    setLocQuery("");
    setResults([]);
    setSearchMsg("");
    setSearchPin(null);
  };


  /* ── the two map modes ────────────────────────────────────────────────
     "Me" is your own movement: the roads you drove, on the day you pick.
     "Friends" is everyone you are connected to, where they are now.

     They used to be drawn on top of each other, always — your line under
     their pins, whether you wanted either or not. Separating them is not
     only tidier: your history and other people's live positions answer
     completely different questions, and only one of them is about today. */
  const [mapMode, setMapMode] = useState<"me" | "earnings">("me");

  /** Which day "Me" is showing. Local midnight, so it means the driver's day. */
  const [pathDay, setPathDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const isToday = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return pathDay.getTime() === t.getTime();
  }, [pathDay]);

  /** Road-matched geometry for whichever day is showing. */
  const [drawnPath, setDrawnPath] = useState<[number, number][]>([]);
  /* The recorded points behind the drawn line. Kept because they carry the
     timestamps — the matched geometry does not, and speed and stops are
     both time. */
  const [dayPoints, setDayPoints] = useState<LocationPoint[]>([]);
  const [pathSnapped, setPathSnapped] = useState(false);
  const [pathLoading, setPathLoading] = useState(false);

  const livePositions = route.map((point) => [point.lat, point.lng] as [number, number]);

  useEffect(() => {
    let cancelled = false;
    setPathLoading(true);

    (async () => {
      // Today comes from the store — it is already in memory and still being
      // appended to as the driver moves. Any other day has to be read back from
      // route_points, which the app has written to since the beginning and never
      // once read.
      const points = isToday ? route : await SupabaseService.routePointsForDay(pathDay);
      if (cancelled) return;

      setDayPoints(points);
      if (points.length < 2) {
        setDrawnPath([]);
        setPathSnapped(false);
        setPathLoading(false);
        return;
      }

      // Draw the raw line immediately, then replace it if the matcher answers.
      // Waiting for the network before showing anything would mean an empty map
      // on every journey through a tunnel.
      setDrawnPath(points.map((p) => [p.lat, p.lng] as [number, number]));
      setPathSnapped(false);

      const matched = await snapToRoads(points);
      if (cancelled) return;
      setDrawnPath(matched.positions);
      setPathSnapped(matched.snapped);
      setPathLoading(false);
    })();

    return () => { cancelled = true; };
    // `route.length` rather than `route`: the array identity changes on every
    // GPS fix, and re-matching the whole day every few seconds would hammer a
    // public service for a line that moved by ten metres.
  }, [pathDay, isToday, route.length]);

  const routePositions = mapMode === "me" ? drawnPath : livePositions;

  /* Two modes on your own map — your path, or where the money came from.
     Friends moved to a page of their own. */
  const nextMode = mapMode === "me" ? "earnings" : "me";

  /* Where the money came from. Earnings accrue from distance travelled, so
     distance inside a cell is earnings from that cell — no new data, and the
     one thing a general-purpose map cannot show, because it does not know
     the driver was working. */
  const heat = useMemo(
    () => (mapMode === "earnings" ? earningsGrid(dayPoints, baseRate) : []),
    [mapMode, dayPoints, baseRate],
  );

  /* Directions to whatever the driver searched for. */
  /* Every alternative OSRM found, and which one the driver has chosen. */
  const [routeOptions, setRouteOptions] = useState<Directions[]>([]);
  const [chosenRoute, setChosenRoute] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [pinnedHere, setPinnedHere] = useState(false);
  const [routing, setRouting] = useState(false);
  const directions = routeOptions[chosenRoute] ?? null;

  useEffect(() => {
    if (!searchPin) { setRouteOptions([]); return; }
    let cancelled = false;
    setRouting(true);
    directionsBetween(currentLocation, searchPin).then((found) => {
      if (cancelled) return;
      // Score what came back against roads this driver has actually driven.
      // Nobody sells live traffic; their own recorded speed is the one signal
      // Waggle owns that a general-purpose map does not.
      setRouteOptions(found ? scoreAgainstHistory(found, dayPoints) : []);
      setChosenRoute(0);
      setRouting(false);
    });
    return () => { cancelled = true; };
    // Only the destination should retrigger this. currentLocation changes on
    // every GPS fix, and re-routing every few seconds would hammer a free
    // service for a line that moved by ten metres.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchPin]);


  /* Speed runs and stops for whatever day is on screen. Recomputed only
     when the drawn path or the underlying points change — walking a few
     thousand vertices on every render would cost more than it shows. */
  const speedRuns = useMemo(
    () => (mapMode === "me" ? speedSegments(dayPoints, drawnPath) : []),
    [mapMode, dayPoints, drawnPath],
  );
  const stops = useMemo(
    () => (mapMode === "me" ? findStops(dayPoints) : []),
    [mapMode, dayPoints],
  );
  const onlineWorkers = workers.filter((worker) => worker.isOnline);

  /**
   * Drivers to show on the friends map: online now, OR seen in the last
   * fifteen minutes.
   *
   * Filtering on `isOnline` alone meant the map emptied the moment a heartbeat
   * was missed — and with a 45s beat that happens on any tunnel, lift or
   * backgrounded call. A driver last seen four minutes ago is still worth
   * showing; they are near where the pin is. Vanishing reads as "nobody is
   * out", which is a different and wrong statement.
   */
  const recentWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          worker.isOnline || (worker.lastSeen != null && Date.now() - worker.lastSeen < RECENT_WINDOW),
      ),
    [workers],
  );

  // Only drivers you are connected with appear on the map. Showing every
  // online driver's live position to everyone is a location-privacy problem,
  // not a feature — and a connection is the app's own definition of "someone
  // who agreed to share with me".
  const connections = useCommunityStore((state) => state.connections);
  const friendWorkers = useMemo(
    () =>
      recentWorkers
        .filter((w) => connectionFor(connections, user?.id, w.id).state === "connected")
        // Nearest first. The roster came out in whatever order the query
        // returned — 1km, <1km, 2km, 6km, 8km, 4km — and distance is the
        // only thing on the row that decides whether somebody's position is
        // any use to you. Reading it meant scanning all six.
        .sort(
          (a, b) =>
            distanceKm(currentLocation, { lat: a.location.lat, lng: a.location.lng }) -
            distanceKm(currentLocation, { lat: b.location.lat, lng: b.location.lng }),
        ),
    [recentWorkers, connections, user?.id, currentLocation],
  );

  /** How many people you are actually connected to, driving or not.
   *  Counted from the connections themselves rather than from who happens to be
   *  on the map, because that is the difference between "you have no friends
   *  yet" and "your friends are not out right now". */
  const acceptedFriendCount = useMemo(
    () =>
      (connections ?? []).filter(
        (c) => c.status === "accepted" && (c.requesterId === user?.id || c.addresseeId === user?.id),
      ).length,
    [connections, user?.id],
  );

  /** Two-letter mark for a map pin, matching WorkAppMark's rule. */
  const markOf = (appId: typeof activeApp) => {
    const name = getWorkApp(appId)?.name ?? "";
    const words = name.trim().split(/[\s-]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    const camel = name.match(/^([A-Za-z])[a-z]*([A-Z])/);
    return camel ? (camel[1] + camel[2]).toUpperCase() : name.slice(0, 1).toUpperCase();
  };

  // Keep the map live. Realtime broadcasts are unreliable for these RLS-heavy
  // tables, so without this a driver who joins — or a friend who starts moving —
  // only appeared after closing and reopening the app. Poll while the map is on
  // screen; the interval is cleared as soon as they navigate away.
  useEffect(() => {
    if (!user || !SupabaseService.enabled || view !== "maps") return undefined;
    void loadCloudCommunity();
    const timer = window.setInterval(() => void loadCloudCommunity(), 10000);
    return () => window.clearInterval(timer);
  }, [user, loadCloudCommunity, view]);
  const pace =
    totalDistanceKm > 0.05 && elapsedMinutes > 0
      ? `${(elapsedMinutes / totalDistanceKm).toFixed(1)}`
      : "--";

  const topDrivers = useMemo(
    () => [...workers].sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 5),
    [workers],
  );

  /** How many of the friends shown are actually beating right now. */
  const liveFriendCount = useMemo(
    () => friendWorkers.filter((worker) => worker.isOnline).length,
    [friendWorkers],
  );

  const meIcon = useMemo(
    () =>
      L.divIcon({
        className: "driver-marker-wrap",
        html: `<div class="driver-marker me">${app?.logo ?? "📍"}</div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      }),
    [app?.logo],
  );

  // Global-ready: center the map on the driver's real location on first open
  // (falls back to the last known / Manila default if GPS is unavailable).
  useEffect(() => {
    if (!map || routePositions.length > 1) return;
    let cancelled = false;
    LocationService.currentPosition()
      .then(async (point) => {
        if (cancelled || !point) return;
        map.setView([point.lat, point.lng], 14, { animate: true });
        // Refine the currency from the actual country the driver is in.
        // (Language stays English by default — users pick their language manually.)
        //
        // Only from a REAL fix. When GPS is denied, missing, or slower than the
        // 5s timeout, currentPosition() returns the Manila default — a normal
        // looking point that reverse-geocodes to "PH". Acting on it converted
        // drivers anywhere in the world to pesos at ₱10/km the first time they
        // opened this screen, which is worse than showing no currency change at
        // all. Centring the map on the default is still fine; inferring the
        // driver's country from it is not.
        if (!point.fallback && useLangStore.getState().autoRegion) {
          const country = await reverseGeocodeCountry(point.lat, point.lng);
          if (!cancelled && country) {
            useProfileStore.getState().applyCurrency(countryToCurrency(country));
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  /* Move to the day you picked.
     Without this, choosing a past date loaded that day's path and left the map
     where it was — which for a driver who has moved city, or simply driven
     across town, is a screen that says "following roads" above empty streets.
     Today is deliberately excluded: it has live follow, and yanking the view
     while someone is driving is worse than not moving at all. */
  useEffect(() => {
    if (!map || mapMode !== "me" || isToday) return;
    if (drawnPath.length > 1) {
      map.fitBounds(drawnPath, { padding: [60, 60], animate: true });
    }
  }, [map, mapMode, isToday, drawnPath]);

  const recenter = () => {
    if (!map) return;
    // Re-centring on yourself resumes live follow after a location search.
    setFollowPaused(false);
    if (routePositions.length > 1) {
      map.fitBounds(routePositions, { padding: [60, 60], animate: true });
    } else {
      map.setView([currentLocation.lat, currentLocation.lng], 15, { animate: true });
    }
  };

  const tile = TILES[mapStyle];
  const featured = challenges[0];
  const dateRange = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `${fmt(new Date())} – ${fmt(new Date(Date.now() + 14 * 86400000))}`;
  }, []);

  return (
    <main className="strava-screen">
      <div className="sv-nav">
        {/* Bee only. The app name lives on Home and Profile. */}
        <BeeMark size={30} className="sv-nav-brand" />
        <div className="sv-nav-tabs">
          <button className={view === "maps" ? "active" : ""} onClick={() => setView("maps")}>{t("sv_maps")}</button>
          <button className={view === "friends" ? "active" : ""} onClick={() => setView("friends")}>{t("sv_friendsTab")}</button>
          <button className={view === "challenges" ? "active" : ""} onClick={() => setView("challenges")}>{t("sv_challenges")}</button>
        </div>
      </div>

      {/* `has-results` does for the results list what `has-route` does for the
          directions panel: gets the sheet and the map controls out from
          underneath it. Measured before adding it — the zoom and layers buttons
          sat over the last 21px of every result line, and the record sheet
          covered the fourth and fifth rows entirely. */}
      {view === "maps" || view === "friends" ? (
        <div
          className={
            "sv-content maps" +
            (view === "friends" ? " is-friends-page" : "") +
            (searchPin ? " has-route" : "") +
            (results.length ? " has-results" : "")
          }
        >
          {/* Me / Friends. Sits over the map rather than above it, because the
              map is the screen and a bar pushing it down costs more than the
              switch is worth. */}
          {/* One button, not two.
              A pair of tabs spends width saying what you are already looking at.
              With only two modes the useful control is a switch: it names where
              tapping takes you, and the note underneath says where you are. */}
          <button
            className={"sv-mapmode is-" + mapMode}
            onClick={() => setMapMode(nextMode)}
            aria-label={t(MODE_KEY[nextMode])}
          >
            <span className="sv-mapmode-now">{t(MODE_KEY[mapMode])}</span>
            <ArrowLeftRight size={14} />
            <span className="sv-mapmode-next">{t(MODE_KEY[nextMode])}</span>
          </button>

          {/* One line saying what is on screen, and how much to trust it. The
              path is either matched to roads or it is a straight line between
              fixes, and those are different claims. */}
          <div className="sv-mapnote">
            {mapMode === "me" ? (
              pathLoading && !drawnPath.length ? (
                <span>{t("sv_loadingPath")}</span>
              ) : drawnPath.length > 1 ? (
                <span>
                  {t("sv_myPath")} ·{" "}
                  <em className={pathSnapped ? "ok" : "raw"}>
                    {pathSnapped ? t("sv_snapped") : t("sv_notSnapped")}
                  </em>
                </span>
              ) : (
                <span>{t("sv_noPathDay")}</span>
              )
            ) : mapMode === "earnings" ? (
              // The note branched on "me" versus everything else, so the
              // earnings map inherited the friends message and told a driver
              // looking at their own heat map that they had no friends.
              heat.length ? (
                <span>
                  {t("sv_earnedHere", {
                    amount: currency(heat.reduce((sum, c) => sum + c.earnings, 0)),
                  })}
                </span>
              ) : (
                <span>{t("sv_heatEmpty")}</span>
              )
            ) : friendWorkers.length ? (
              <span>{t("sv_friendsOn", { count: String(friendWorkers.length) })}</span>
            ) : acceptedFriendCount === 0 ? (
              // Two different empty maps that used to read the same. Nobody
              // connected is a thing to go and do; connected-but-not-driving is
              // a thing to wait for. Telling someone their friends are not
              // sharing their location when they have no friends yet sends them
              // looking for a setting that was never the problem.
              <span>{t("sv_noFriendsYet")}</span>
            ) : (
              <span>{t("sv_noFriends")}</span>
            )}
          </div>

          {/* Which day, in "Me" only. Native date input: it is localised,
              keyboard-accessible and already familiar on every phone, which no
              hand-rolled calendar in this codebase would be. */}
          {/* Directions, when the driver has searched for somewhere. The
              free-flow caveat is not small print: these timings have never seen
              a traffic jam, and a driver planning a delivery around an ETA that
              silently assumes empty roads is the dangerous kind of wrong. */}
          {searchPin && mapMode !== "earnings" ? (
            <div className="sv-directions">
              <div className="sv-directions-head">
                <strong>{searchPin.label}</strong>
                <button aria-label={t("sv_clearRoute")} onClick={() => { setSearchPin(null); setRouteOptions([]); }}>
                  <X size={15} />
                </button>
              </div>
              {routing ? (
                <p className="sv-directions-meta"><Loader2 size={13} className="spin" /> …</p>
              ) : directions ? (
                <>
                  {/* Every alternative, so the choice is the driver's. Shortest
                      and fastest are usually different roads, and which matters
                      depends on fuel, on tolls, and on what they know. */}
                  {routeOptions.length > 1 ? (
                    <div className="sv-routeopts">
                      {routeOptions.map((r, i) => {
                        const fastest = r.minutes === Math.min(...routeOptions.map((x) => x.minutes));
                        const shortest = r.km === Math.min(...routeOptions.map((x) => x.km));
                        return (
                          <button
                            key={i}
                            className={i === chosenRoute ? "is-on" : ""}
                            onClick={() => setChosenRoute(i)}
                          >
                            <b>{r.minutes} min</b>
                            <small>{r.km} km</small>
                            {fastest ? <em className="tag-fast">{t("sv_fastest")}</em>
                              : shortest ? <em className="tag-short">{t("sv_shortest")}</em> : null}
                            {/* Their own recorded speed on these roads. Shown as
                                a note, never used to reorder — ranking routes on
                                two data points is worse than not ranking. */}
                            {r.observedKmh ? (
                              <em className="tag-seen">{t("sv_yourAvg", { kmh: String(r.observedKmh) })}</em>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <p className="sv-directions-meta">
                    <b>{t("sv_routeTo", { km: String(directions.km), min: String(directions.minutes) })}</b>
                    <em>{t("sv_freeFlow")}</em>
                  </p>
                  {/* Steps, Start, Pin — the three things a driver does with a
                      route. Steps folds the list away, because six turns is a
                      lot of panel on a phone held at a junction. */}
                  <div className="sv-routeacts">
                    <button className={stepsOpen ? "is-on" : ""} onClick={() => setStepsOpen((v) => !v)}>
                      <RouteIcon size={14} /> {t("sv_steps")}
                    </button>
                    <button className="primary" onClick={() => { if (!isTracking) void startTracking(); }}>
                      <Flag size={14} /> {t("sv_start")}
                    </button>
                    <button
                      className={pinnedHere ? "is-on" : ""}
                      onClick={() => setPinnedHere((v) => !v)}
                    >
                      <MapPin size={14} /> {t("sv_pin")}
                    </button>
                  </div>
                  <ol className="sv-steps" hidden={!stepsOpen}>
                    {directions.steps.slice(0, 6).map((step, i) => (
                      <li key={i}>
                        <span>{describeStep(step)}</span>
                        <small>{step.metres >= 1000 ? (step.metres / 1000).toFixed(1) + " km" : step.metres + " m"}</small>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="sv-directions-meta">{t("sv_noRoute")}</p>
              )}
            </div>
          ) : null}

          {/* What the colours mean. Without this the route is decorative;
              with it a driver can see where the day was spent crawling. */}
          {mapMode === "me" && speedRuns.length ? (
            <div className="sv-speedkey">
              <span><i style={{ background: BAND_COLOUR.stopped }} />{t("sv_bandStopped")}</span>
              <span><i style={{ background: BAND_COLOUR.slow }} />{t("sv_bandSlow")}</span>
              <span><i style={{ background: BAND_COLOUR.moving }} />{t("sv_bandMoving")}</span>
              <span><i style={{ background: BAND_COLOUR.fast }} />{t("sv_bandFast")}</span>
            </div>
          ) : null}

          {mapMode === "me" ? (
            <div className="sv-daypick">
              <label>
                <span className="sr-only">{t("sv_pickDay")}</span>
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={`${pathDay.getFullYear()}-${String(pathDay.getMonth() + 1).padStart(2, "0")}-${String(pathDay.getDate()).padStart(2, "0")}`}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    // Split rather than new Date(string): the bare form is
                    // parsed as UTC, which lands on the previous day for anyone
                    // west of Greenwich.
                    const [y, m, d] = e.target.value.split("-").map(Number);
                    setPathDay(new Date(y, m - 1, d, 0, 0, 0, 0));
                  }}
                />
              </label>
              {!isToday ? (
                <button
                  className="sv-today"
                  onClick={() => {
                    const d = new Date();
                    d.setHours(0, 0, 0, 0);
                    setPathDay(d);
                  }}
                >
                  {t("sv_today")}
                </button>
              ) : null}
            </div>
          ) : null}

          <MapContainer
            center={[currentLocation.lat, currentLocation.lng]}
            zoom={13}
            zoomControl={false}
            /* Leaflet stamps "Leaflet" in front of every attribution by
               default. That one is a courtesy to the library, not a licence
               term, so it goes. What stays is the data credit — OpenStreetMap
               and OpenMapTiles require it under ODbL, and it is the reason
               these tiles are free to use at all. Removing that would be
               using the data in breach of the licence, not tidying a map. */
            attributionControl={false}
            scrollWheelZoom
            className="strava-map"
            ref={setMap}
          >
            {/* Satellite stays raster — imagery IS pixels, there is no vector
                form of it. Everything else renders as vectors. */}
            {mapStyle === "satellite" ? (
              <TileLayer key={tile.url} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains as never} />
            ) : (
              <VectorBasemap />
            )}
            <MapFollow lat={currentLocation.lat} lng={currentLocation.lng} follow={isTracking && !followPaused} />
            <Marker position={[currentLocation.lat, currentLocation.lng]} icon={meIcon} />
            {/* Your path belongs to "Me". In Friends mode it would just be
                clutter under other people's pins. Dashed while it is a raw
                trace, solid once it is sitting on real roads — so the map says
                which of the two it is rather than implying the better one. */}
            {mapMode === "me" && routePositions.length > 1 ? (
              <>
                {/* The casing underneath, so the coloured run reads as one
                    route rather than as loose pieces of different colours. */}
                <Polyline positions={routePositions} pathOptions={{ color: "#7c2d12", weight: 11, opacity: 0.22 }} />
                {speedRuns.length ? (
                  speedRuns.map((run, i) => (
                    <Polyline
                      key={i}
                      positions={run.positions}
                      pathOptions={{
                        color: BAND_COLOUR[run.band],
                        weight: 5,
                        opacity: 0.96,
                        lineCap: "round",
                        dashArray: pathSnapped ? undefined : "6 7",
                      }}
                    />
                  ))
                ) : (
                  <Polyline
                    positions={routePositions}
                    /* Brand indigo. This is the app's own line on someone
                       else's map, so it carries the company colour — unlike
                       BAND_COLOUR in RouteInsights, which stays a semantic
                       red/amber/orange/green speed ramp and is not brand at
                       all. */
                    pathOptions={{ color: "#4338ca", weight: 5, opacity: 0.95, dashArray: pathSnapped ? undefined : "6 7" }}
                  />
                )}
                {/* Where the shift actually stood still. On a delivery map that
                    is the interesting part: a queue at a restaurant, a wait for
                    a customer, a break. */}
                {stops.map((stop, i) => (
                  <Marker
                    key={`stop-${i}`}
                    position={[stop.lat, stop.lng]}
                    icon={L.divIcon({
                      className: "stop-marker-wrap",
                      html: `<div class="stop-marker"><span>${stop.minutes}</span></div>`,
                      iconSize: [26, 26],
                      iconAnchor: [13, 13],
                    })}
                  />
                ))}
              </>
            ) : null}
            {/* The earnings heatmap. Each cell is 250 m of ground, weighted by
                the distance driven inside it — which in this app is the money
                earned there. A general-purpose map cannot draw this, because it
                does not know the person was working. */}
            {mapMode === "earnings" && heat.map((cell, i) => (
              <CircleMarker
                key={`heat-${i}`}
                center={[cell.lat, cell.lng]}
                radius={9 + cell.weight * 16}
                pathOptions={{
                  color: heatColour(cell.weight),
                  fillColor: heatColour(cell.weight),
                  // Deliberately translucent: overlapping cells build up, which
                  // is what makes a heat map read as heat rather than as dots.
                  fillOpacity: 0.18 + cell.weight * 0.34,
                  weight: 0,
                }}
              />
            ))}

            {/* Directions to a searched place. Drawn under nothing else, and in
                a colour no other line on this map uses, so it cannot be mistaken
                for where the driver has already been. */}
            {routeOptions.map((r, i) =>
              i === chosenRoute ? null : (
                // The roads not taken, faint, so the choice is visible on the
                // map and not only in the list.
                <Polyline
                  key={`alt-${i}`}
                  positions={r.positions}
                  pathOptions={{ color: "#64748b", weight: 4, opacity: 0.45, dashArray: "2 8" }}
                  eventHandlers={{ click: () => setChosenRoute(i) }}
                />
              ),
            )}
            {/* The time sits on the road it belongs to. This is the single
                element that makes a screen read as a maps app rather than as a
                map with a panel over it — the number is attached to the line,
                so a glance answers "which one" without reading a list.
                Waggle's own language: brand fill for the chosen route, outline
                for the ones not taken, and the bee's orange rather than a
                borrowed blue. */}
            {routeOptions.map((r, i) => {
              const mid = r.positions[Math.floor(r.positions.length / 2)];
              if (!mid) return null;
              const on = i === chosenRoute;
              return (
                <Marker
                  key={`eta-${i}`}
                  position={mid}
                  zIndexOffset={on ? 1000 : 0}
                  icon={L.divIcon({
                    className: "eta-wrap",
                    html: `<div class="eta${on ? " is-on" : ""}">${r.minutes} min</div>`,
                    iconSize: [58, 26],
                    iconAnchor: [29, 13],
                  })}
                  eventHandlers={{ click: () => setChosenRoute(i) }}
                />
              );
            })}
            {directions ? (
              <>
                <Polyline positions={directions.positions} pathOptions={{ color: "#0b3d91", weight: 10, opacity: 0.22 }} />
                <Polyline positions={directions.positions} pathOptions={{ color: "#1d4ed8", weight: 5, opacity: 0.95, dashArray: "1 9", lineCap: "round" }} />
              </>
            ) : null}

            {view === "friends" && friendWorkers.map((worker) => (
              <Marker
                key={worker.id}
                position={[worker.location.lat, worker.location.lng]}
                icon={L.divIcon({
                  className: worker.isOnline ? "driver-marker-wrap" : "driver-marker-wrap is-stale",
                  // The name rides above the circle in a small callout. It is
                  // positioned absolutely, so the wrapper stays 34x34 and the
                  // circle still sits exactly on the coordinate — iconAnchor
                  // below depends on that being unchanged.
                  //
                  // worker.name is another driver's typed input going into an
                  // HTML string, so it is escaped rather than interpolated raw.
                  html:
                    `<div class="driver-marker" style="background:${getWorkApp(worker.app)?.color ?? "#555"}">` +
                    `${markOf(worker.app)}` +
                    `<span class="driver-cloud">${escapeHtml(firstNameOf(worker.name))}</span>` +
                    `</div>`,
                  iconSize: [34, 34],
                  iconAnchor: [17, 17],
                })}
              />
            ))}
            {searchPin ? (
              <Marker
                position={[searchPin.lat, searchPin.lng]}
                icon={L.divIcon({
                  className: "search-pin-wrap",
                  html: `<div class="search-pin">📍</div>`,
                  iconSize: [34, 34],
                  iconAnchor: [17, 30],
                })}
              />
            ) : null}
            <ScaleControl position="bottomleft" imperial={false} />
          </MapContainer>

          <div className="sv-top">
            <form className="sv-searchbar" onSubmit={searchLocation}>
              <div className="sv-brand"><RouteIcon size={18} /></div>
              <input
                value={locQuery}
                onChange={(event) => {
                  setLocQuery(event.target.value);
                  if (searchMsg) setSearchMsg("");
                }}
                placeholder={t("sv_searchLocation")}
                enterKeyHint="search"
              />
              {locQuery.trim() ? (
                <>
                  <button type="button" className="sv-search-clear" onClick={clearSearch} aria-label={t("sv_clear")}>
                    <X size={16} />
                  </button>
                  <button type="submit" className="sv-search-go" disabled={searching} aria-label={t("sv_searchLocation")}>
                    {searching ? <Loader2 size={17} className="sv-spin" /> : <Search size={17} />}
                  </button>
                </>
              ) : null}
            </form>
            {results.length ? (
              <ul className="sv-results">
                {results.map((hit, index) => (
                  <li key={`${hit.lat},${hit.lng},${index}`}>
                    <button onClick={() => selectResult(hit)}>
                      <MapPin size={16} />
                      <span>
                        <strong>{hit.label}</strong>
                        {hit.sub ? <small>{hit.sub}</small> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {searchMsg ? <p className="sv-search-msg">{searchMsg}</p> : null}
          </div>

          {/* The layer switch used to be the third button in the rail below.
              It does not fit: between the mode row and the record sheet there
              are 188px, and locate + zoom + layers need 212. Anchoring the rail
              lower buried the layer button under the sheet; anchoring it higher
              put it on top of the date picker, where elementFromPoint proved a
              tap on the calendar opened "centre on me" instead.

              So it moves rather than shuffling the collision around. It is the
              least-used control here — a driver switches to satellite rarely
              and re-centres constantly — and top-right beside the search is
              where map apps put a layer toggle anyway. */}
          <button
            className="sv-layerbtn"
            aria-label={t("a11y_changeMapLayer")}
            aria-pressed={mapStyle === "satellite"}
            onClick={() => setMapStyle((s) => (s === "standard" ? "satellite" : "standard"))}
          >
            <Layers size={18} />
          </button>

          <div className="sv-rail" ref={railRef}>
            <button className="sv-rail-btn" aria-label={t("a11y_centerOnMe")} onClick={recenter}>
              <LocateFixed size={19} />
            </button>
            <div className="sv-zoom">
              <button aria-label={t("a11y_zoomIn")} onClick={() => map?.zoomIn()}><Plus size={18} /></button>
              <span className="sv-zoom-div" />
              <button aria-label={t("a11y_zoomOut")} onClick={() => map?.zoomOut()}><Minus size={18} /></button>
            </div>
          </div>

          {/* The friends page gets a roster instead of a record sheet. The
              questions are different: on your own map it is "how is my shift
              going", here it is "who is out, on what, and where" — so this
              lists people with what they are driving for and how far away they
              are, and tapping one flies the map to them. */}
          {view === "friends" ? (
            <div className={`sv-sheet sv-friendsheet${sheetCollapsed ? " is-collapsed" : ""}`} ref={sheetRef}>
              <button
                type="button"
                className="sv-sheet-grip"
                aria-label={t(sheetCollapsed ? "sv_expandSheet" : "sv_collapseSheet")}
                aria-expanded={!sheetCollapsed}
                {...gripHandlers}
              />
              <div className="sv-sheet-title">
                <strong>{t("sv_friendsTab")}</strong>
                {/* Only when there is something to count. With nobody out
                    the body below already says so, and a subtitle repeating
                    it in different words reads like two separate problems. */}
                {/* "sharing right now" is only true of the ones actually
                    beating. With stale drivers in the list it claimed a
                    liveness three of five did not have, so the count is of
                    who is live and the label changes when it is a mixture. */}
                {friendWorkers.length ? (
                  <span className="sv-live">
                    {liveFriendCount === friendWorkers.length
                      ? t("sv_friendsSharing", { count: String(liveFriendCount) })
                      : t("sv_friendsNearby", { count: String(friendWorkers.length) })}
                  </span>
                ) : null}
              </div>
              {friendWorkers.length ? (
                <ul className="sv-friendlist">
                  {friendWorkers.map((worker) => {
                    const workApp = getWorkApp(worker.app);
                    const away = distanceKm(currentLocation, {
                      lat: worker.location.lat,
                      lng: worker.location.lng,
                    });
                    return (
                      <li key={worker.id} className={worker.isOnline ? "" : "is-stale"}>
                        <button
                          type="button"
                          onClick={() => {
                            setFollowPaused(true);
                            map?.setView([worker.location.lat, worker.location.lng], 15, { animate: true });
                          }}
                        >
                          <span
                            className="sv-friend-dot"
                            style={{ background: workApp?.color ?? "#555" }}
                            aria-hidden
                          >
                            {markOf(worker.app)}
                          </span>
                          <span className="sv-friend-who">
                            <strong>{worker.name}</strong>
                            {/* Platform, then either today's distance or when
                                they were last heard from — not both. All three
                                ran past the row and truncated to "last seen …",
                                which is the one part that had to be readable. */}
                            <small>
                              {workApp?.name ?? t("sv_modeMe")} &middot;{" "}
                              {!worker.isOnline && worker.lastSeen
                                ? t("wa_lastSeen", { time: timeAgo(worker.lastSeen) })
                                : km(worker.distanceKm)}
                            </small>
                          </span>
                          <span className="sv-friend-away">
                            {away < 1 ? "<1" : Math.round(away)}
                            <em>km</em>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="sv-friend-empty">{t("sv_noFriendsYet")}</p>
              )}
            </div>
          ) : (
          <div className={`sv-sheet${sheetCollapsed ? " is-collapsed" : ""}`} ref={sheetRef}>
            <button
              type="button"
              className="sv-sheet-grip"
              aria-label={t(sheetCollapsed ? "sv_expandSheet" : "sv_collapseSheet")}
              aria-expanded={!sheetCollapsed}
              {...gripHandlers}
            />
            <div className="sv-sheet-title">
              <strong>{isTracking ? t("sv_recording") : t("sv_ready")}</strong>
              <span className={`sv-live ${isTracking ? "on" : ""}`}>{isTracking ? "● LIVE" : app ? `${app.logo} ${app.name}` : t("sv_gpsReady")}</span>
            </div>
            <div className="sv-stats">
              <SvStat icon={<MapPin size={16} />} value={totalDistanceKm.toFixed(2)} unit="km" label={t("sv_distance")} />
              <SvStat icon={<Timer size={16} />} value={duration(elapsedMinutes)} label={t("sv_time")} />
              <SvStat icon={<Gauge size={16} />} value={pace} unit="/km" label={t("sv_pace")} />
            </div>
            <button
              className={`sv-record ${isTracking ? "stop" : ""}`}
              onClick={isTracking ? stopTracking : startTracking}
            >
              {isTracking ? <><Square size={18} fill="currentColor" /> {t("home_stopTracking")}</> : <><span className="sv-record-dot" /> {t("home_startTracking")}</>}
            </button>
          </div>
          )}
        </div>
      ) : (
        <div className="sv-content challenges">
          {featured ? (
            <article className="svc-hero">
              <div className="svc-hero-media">
                <span className="svc-hero-emoji"><ChallengeIcon icon={featured.icon} size={26} /></span>
              </div>
              <div className="svc-hero-body">
                <span className="svc-badge"><Award size={26} /></span>
                <h3>{titleOf(featured)}</h3>
                <div className="svc-line"><Target size={16} /> {featured.description}</div>
                <div className="svc-line"><Trophy size={16} /> {t("sv_heroUnlock")}</div>
                <div className="svc-line"><CalendarDays size={16} /> {dateRange}</div>
                <button
                  className={`svc-join ${featured.joined ? "joined" : ""}`}
                  onClick={() => toggleChallenge(featured.id)}
                >
                  {featured.joined ? t("sv_joinedCheck") : t("sv_joinChallenge")}
                </button>
              </div>
            </article>
          ) : null}

          <div className="svc-section-head">
            <div>
              <h4>{t("sv_recommended")}</h4>
              <span>{t("sv_basedOn")}</span>
            </div>
          </div>
          <div className="svc-list">
            {challenges.map((challenge) => {
              const progress = progressFor(challenge);
              const pct = Math.min(100, Math.round((progress / targetOf(challenge)) * 100));
              return (
                <article className="svc-card" key={challenge.id}>
                  <div className="svc-card-media">
                    <span className="svc-card-emoji"><ChallengeIcon icon={challenge.icon} size={22} /></span>
                  </div>
                  <div className="svc-card-body">
                    <strong>
                      {titleOf(challenge)}
                    </strong>
                    <p>{challenge.description}</p>
                    <div className="svc-bar"><span style={{ width: `${pct}%` }} /></div>
                    <div className="svc-card-foot">
                      <small>{Math.round(progress)} / {targetOf(challenge)} · {pct}%</small>
                      <div className="svc-card-actions">
                        <button
                          className={`svc-mini ${challenge.joined ? "joined" : ""}`}
                          onClick={() => toggleChallenge(challenge.id)}
                        >
                          {challenge.joined ? t("sv_joined") : t("sv_join")}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <article className="svc-board">
            <h4><Trophy size={17} /> {t("sv_leaders")}</h4>
            {topDrivers.length ? (
              topDrivers.map((worker, index) => (
                <div className="svc-rank" key={worker.id}>
                  <span className={`svc-place p${index + 1}`}>{index + 1}</span>
                  <span className="svc-rank-avatar">{initials(worker.name)}</span>
                  <strong>{worker.name}</strong>
                  <span className="svc-rank-km">{km(worker.distanceKm)}</span>
                </div>
              ))
            ) : (
              <p className="svc-board-empty">{t("sv_leadersEmpty")}</p>
            )}
          </article>
        </div>
      )}

    </main>
  );
}

function SvStat({
  icon,
  value,
  unit,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <div className="sv-stat">
      <span className="sv-stat-icon">{icon}</span>
      <strong>
        {value}
        {unit ? <em>{unit}</em> : null}
      </strong>
      <small>{label}</small>
    </div>
  );
}

function MapFollow({ lat, lng, follow }: { lat: number; lng: number; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow) {
      map.setView([lat || MANILA_CENTER.lat, lng || MANILA_CENTER.lng], map.getZoom(), { animate: true });
    }
  }, [lat, lng, follow, map]);
  return null;
}
