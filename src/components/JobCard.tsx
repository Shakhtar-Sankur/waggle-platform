import { Clock, MapPin } from "lucide-react";
import { useJobStore } from "../stores/useJobStore";
import type { Job } from "../types";
import { currency, km } from "../utils/format";
import { getWorkApp } from "../utils/workApps";
import { Button } from "./ui/Button";

export function JobCard({ job }: { job: Job }) {
  const acceptJob = useJobStore((state) => state.acceptJob);
  const declineJob = useJobStore((state) => state.declineJob);
  const completeJob = useJobStore((state) => state.completeJob);
  const app = getWorkApp(job.app);

  return (
    <article className={`job-card ${job.status !== "open" ? "muted" : ""}`}>
      <div className="job-card-top">
        <div>
          <span className="pill">{app?.logo} {app?.name}</span>
          <h4>{job.title}</h4>
        </div>
        <strong>{currency(job.payout)}</strong>
      </div>
      <div className="job-route">
        <MapPin size={16} />
        <span>{job.pickup}</span>
        <span>→</span>
        <span>{job.dropoff}</span>
      </div>
      <div className="job-meta">
        <span><Clock size={15} /> {job.etaMinutes} min</span>
        <span>{km(job.distanceKm)}</span>
      </div>
      <div className="job-actions">
        {job.status === "open" ? (
          <>
            <Button variant="outline" onClick={() => declineJob(job.id)}>Decline</Button>
            <Button onClick={() => acceptJob(job.id)}>Accept</Button>
          </>
        ) : job.status === "accepted" ? (
          <Button onClick={() => completeJob(job.id)}>Complete Job</Button>
        ) : (
          <span className="status-label">{job.status}</span>
        )}
      </div>
    </article>
  );
}
