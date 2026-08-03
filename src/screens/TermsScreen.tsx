import { Link } from "react-router-dom";
import { APP_NAME } from "../config/constants";

export function TermsScreen() {
  return (
    <main className="legal-page">
      <header>
        <Link to="/auth">← Back</Link>
        <h1>Terms of Service</h1>
        <p>Last updated: June 14, 2026</p>
      </header>

      <section>
        <h2>Acceptance</h2>
        <p>
          By creating an account or using {APP_NAME}, you agree to these Terms and our Privacy
          Policy. If you do not agree, do not use the app.
        </p>
      </section>

      <section>
        <h2>Eligibility</h2>
        <p>
          You must be at least 18 years old and legally permitted to work as a driver or delivery
          partner in your jurisdiction.
        </p>
      </section>

      <section>
        <h2>Acceptable Use</h2>
        <ul>
          <li>Use GPS tracking only while actively working and in compliance with local laws.</li>
          <li>Do not harass other users or share unlawful content in chat or community feeds.</li>
          <li>Do not attempt to disrupt, reverse engineer, or abuse the service.</li>
        </ul>
      </section>

      <section>
        <h2>Location &amp; Safety</h2>
        <p>
          {APP_NAME} provides informational tools only. Always follow traffic laws and platform
          partner policies (Grab, Angkas, etc.). We are not responsible for accidents, fines, or
          third-party platform decisions.
        </p>
      </section>

      <section>
        <h2>Account Termination</h2>
        <p>
          You may delete your account at any time in Profile settings. We may suspend accounts that
          violate these Terms or applicable law.
        </p>
      </section>

      <section>
        <h2>Disclaimer</h2>
        <p>
          The app is provided "as is" without warranties. Earnings estimates are approximate and
          based on your configured rate and tracked distance.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Support: <a href="mailto:support@masayaako.app">support@masayaako.app</a>
        </p>
      </section>
    </main>
  );
}
