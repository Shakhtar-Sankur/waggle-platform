export type WorkAppId =
  // Philippines / SEA
  | "grab"
  | "angkas"
  | "moveit"
  | "joyride"
  | "foodpanda"
  | "gojek"
  | "lalamove"
  | "shopeefood"
  | "maxim"
  // India
  | "uber"
  | "ola"
  | "rapido"
  | "swiggy"
  | "zomato"
  | "zepto"
  | "blinkit"
  | "bigbasket"
  | "dunzo"
  | "porter"
  | "amazon"
  | "flipkart"
  // Global / West / Middle East
  | "ubereats"
  | "doordash"
  | "deliveroo"
  | "bolt"
  | "indrive"
  | "glovo"
  | "wolt"
  | "justeat"
  | "rappi"
  | "careem"
  | "talabat"
  | "instacart"
  | "others";

export type VehicleType = "car" | "motorcycle" | "bicycle";

export type JobStatus = "open" | "accepted" | "declined" | "completed";

export type MessageStatus = "sent" | "delivered" | "read";

export interface WorkApp {
  id: WorkAppId;
  name: string;
  logo: string;
  color: string;
  /** ISO country codes where this platform operates, used to surface the
   *  relevant apps first. Empty/undefined means "show everywhere". */
  regions?: string[];
}

export interface UserSession {
  id: string;
  fullName: string;
  phone: string;
}

export interface ProfileSettings {
  activeApp: WorkAppId | null;
  homeAddress: string;
  baseRate: number;
  dailyGoal: number;
  vehicleType: VehicleType;
  maintenanceKm: number;
  shareStats: boolean;
  /** ISO 4217 code the driver's earnings/rates are shown in (e.g. "PHP", "USD"). */
  currencyCode: string;
}

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: number;
}

export interface Worker {
  id: string;
  name: string;
  app: WorkAppId;
  distanceKm: number;
  earnings: number;
  isOnline: boolean;
  /** Epoch ms of the user's last presence heartbeat (for WhatsApp-style "last seen"). */
  lastSeen?: number;
  location: LocationPoint;
  rating: number;
  tags: string[];
}

export interface Job {
  id: string;
  title: string;
  pickup: string;
  dropoff: string;
  distanceKm: number;
  payout: number;
  app: WorkAppId;
  etaMinutes: number;
  status: JobStatus;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: number;
  status: MessageStatus;
  attachmentUrl?: string;
  attachmentThumbUrl?: string;
}

export interface ChatThread {
  id: string;
  title: string;
  participantIds: string[];
  isGroup: boolean;
  unreadCount: number;
  typingUserIds: string[];
  updatedAt: number;
}

export interface FeedPost {
  id: string;
  userId?: string;
  author: string;
  initials: string;
  body: string;
  imageUrl?: string;
  /** Small copy shown in the feed. Absent on legacy inline-image posts. */
  imageThumbUrl?: string;
  /** Queued in the outbox: written locally, not yet accepted by the server. */
  pending?: boolean;
  likes: number;
  likedByMe: boolean;
  commentCount: number;
  createdAt: number;
}

export interface PostComment {
  id: string;
  postId: string;
  author: string;
  initials: string;
  body: string;
  createdAt: number;
}

export type ConnectionState = "none" | "pending_out" | "pending_in" | "connected";

export interface Connection {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: "pending" | "accepted";
}

/** What real activity fills a challenge's progress bar this week. */
export type ChallengeMetric = "distance" | "earnings" | "social";

export interface Challenge {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  target: number;
  joined: boolean;
  /** Which weekly activity drives progress (defaults inferred from id for built-ins). */
  metric?: ChallengeMetric;
  /** True for challenges the user created themselves (so they can be removed). */
  custom?: boolean;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  members: number;
  color: string;
  icon: string;
  joined: boolean;
}

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  read: boolean;
  kind: "job" | "chat" | "system" | "location";
}
