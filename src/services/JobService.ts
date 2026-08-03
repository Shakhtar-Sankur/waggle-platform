import { seededJobs } from "../data/seed";
import type { Job } from "../types";
import { uid } from "../utils/format";

export const JobService = {
  list(): Job[] {
    return seededJobs;
  },

  generateLiveJob(): Job {
    const pickups = ["Ayala Center", "Ortigas Center", "BGC High Street", "Robinsons Manila", "Cubao Gateway"];
    const dropoffs = ["Makati Avenue", "Eastwood City", "MOA Complex", "Poblacion", "Quezon Avenue"];
    const apps: Job["app"][] = ["grab", "foodpanda", "moveit", "angkas", "joyride"];
    const distanceKm = Number((3 + Math.random() * 9).toFixed(1));
    const app = apps[Math.floor(Math.random() * apps.length)];
    return {
      id: uid("job"),
      title: app === "foodpanda" ? "Food delivery request" : app === "moveit" ? "Parcel delivery request" : "Ride request",
      pickup: pickups[Math.floor(Math.random() * pickups.length)],
      dropoff: dropoffs[Math.floor(Math.random() * dropoffs.length)],
      distanceKm,
      payout: Math.round(distanceKm * (28 + Math.random() * 12)),
      app,
      etaMinutes: Math.round(10 + distanceKm * 2),
      status: "open",
    };
  },
};
