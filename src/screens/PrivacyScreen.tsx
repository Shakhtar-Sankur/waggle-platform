import { Link } from "react-router-dom";
import { APP_NAME } from "../config/constants";

export function PrivacyScreen() {
  return (
    <main className="legal-page">
      <header>
        <Link to="/auth">← Back</Link>
        <h1>Privacy Policy</h1>
        <p>Last updated: June 14, 2026</p>
      </header>

      <section>
        <h2>Overview</h2>
        <p>
          {APP_NAME} ("we", "our", or "the app") helps ride-hailing and delivery drivers track routes,
          earnings, community activity, and messaging. This policy explains what we collect, why we
          collect it, and your choices.
        </p>
      </section>

      <section>
        <h2>Data We Collect</h2>
        <ul>
          <li>
            <strong>Account data:</strong> name, phone number, and authentication credentials stored
            securely with Supabase Auth.
          </li>
          <li>
            <strong>Location data:</strong> GPS coordinates while you actively start tracking, used
            for route history, distance, and optional community map sharing.
          </li>
          <li>
            <strong>Profile &amp; vehicle settings:</strong> home address, vehicle type, earnings
            rate, and work app preferences.
          </li>
          <li>
            <strong>Chat &amp; community content:</strong> messages, posts, and attachments you
            choose to share.
          </li>
          <li>
            <strong>Camera/photos:</strong> only when you attach images in chat or profile flows.
          </li>
          <li>
            <strong>Push tokens:</strong> device tokens for job and message notifications when you
            grant notification permission.
          </li>
        </ul>
      </section>

      <section>
        <h2>How We Use Data</h2>
        <ul>
          <li>Provide core app features: tracking, routes, chat, and community.</li>
          <li>Sync your data across devices when cloud mode is enabled.</li>
          <li>Send local and push notifications you opt into.</li>
          <li>Improve reliability and security of the service.</li>
        </ul>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          We do not sell personal data. Location and stats may be visible to other drivers only when
          you enable "Share stats with community." Data is processed by Supabase (hosting/database)
          and Firebase Cloud Messaging (push delivery) under their respective terms.
        </p>
      </section>

      <section>
        <h2>Retention &amp; Deletion</h2>
        <p>
          You may delete your account at any time from Profile → Delete Account. This removes your
          profile, settings, routes, chat memberships, and notifications from our database. Some
          logs may persist briefly in backup systems per our infrastructure providers.
        </p>
      </section>

      <section>
        <h2>Your Rights</h2>
        <p>
          You can access and update profile data in-app, revoke location or notification
          permissions in device settings, and contact us to request data export or deletion.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Privacy questions: <a href="mailto:privacy@masayaako.app">privacy@masayaako.app</a>
        </p>
      </section>
    </main>
  );
}
