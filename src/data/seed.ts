import type { Challenge, ChatMessage, ChatThread, FeedPost, Group, Job, Worker } from "../types";

// Real users start with a clean slate. These are intentionally empty — live data
// (jobs, community posts, nearby drivers, chat) comes from Supabase once cloud mode
// is configured. Keeping them empty means no fake/demo content is ever shown.
export const seededWorkers: Worker[] = [];
export const seededJobs: Job[] = [];
export const seededThreads: ChatThread[] = [];
export const seededMessages: ChatMessage[] = [];
export const seededPosts: FeedPost[] = [];

// Challenges are app-defined goals (not fabricated history), so a new user can join
// them and start from zero progress.
export const seededChallenges: Challenge[] = [
  {
    id: "challenge_earn",
    // {amount} is swapped for the driver's own currency at render time — a USD
    // user must not see a hardcoded peso figure.
    title: "{amount} Weekly Run",
    description: "Track trips and reach your weekly earnings goal.",
    icon: "🏆",
    progress: 0,
    target: 2500,
    joined: false,
  },
  {
    id: "challenge_distance",
    title: "100 km Club",
    description: "Complete 100 tracked kilometers this week.",
    icon: "🗺️",
    progress: 0,
    target: 100,
    joined: false,
  },
  {
    id: "challenge_social",
    title: "Community Helper",
    description: "Send 5 helpful route updates in chat.",
    icon: "🤝",
    progress: 0,
    target: 5,
    joined: false,
  },
];

// App-defined driver communities a user can join. Counts start at 0 and are
// ONLY a fallback shape for when the cloud is unreachable - never invent members.
export const seededGroups: Group[] = [
  {
    id: "group_grab_mnl",
    name: "Grab Drivers Manila",
    description: "Tips, surge alerts, and support for Metro Manila Grab drivers.",
    members: 0,
    color: "#00b14f",
    icon: "🚗",
    joined: false,
  },
  {
    id: "group_angkas",
    name: "Angkas Riders PH",
    description: "Route hacks and rider community for Angkas motorcycle drivers.",
    members: 0,
    color: "#0d3b66",
    icon: "🏍️",
    joined: false,
  },
  {
    id: "group_foodpanda",
    name: "Foodpanda Riders Community",
    description: "Peak-hour zones, batching tips, and rider meetups.",
    members: 0,
    color: "#d70f64",
    icon: "🛵",
    joined: false,
  },
  {
    id: "group_traffic",
    name: "Metro Manila Traffic Updates",
    description: "Live road, flood, and checkpoint updates from fellow drivers.",
    members: 0,
    color: "#f59e0b",
    icon: "🚦",
    joined: false,
  },
  {
    id: "group_tips",
    name: "Gig Worker Tips & Tricks",
    description: "Earn more, spend less — advice from experienced gig drivers.",
    members: 0,
    color: "#7c3aed",
    icon: "💡",
    joined: false,
  },
];
