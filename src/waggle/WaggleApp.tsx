import { Navigate, Route, Routes } from "react-router-dom";
import { SendPage, SendTrackPage } from "./WaggleSend";
import { Toasts } from "../components/Toasts";
import { AuthScreen } from "../screens/AuthScreen";
import { useAuthStore } from "../stores/useAuthStore";
import { useEffect } from "react";
import { AccountPage, OrdersPage } from "./WaggleAccount";
import { GroupPage } from "./WaggleGroup";
import { HomePage } from "./WaggleHome";
import { SearchPage } from "./WaggleSearch";
import { ShopPage } from "./WaggleShop";
import { TrackPage } from "./WaggleTrack";

/**
 * Waggle, the customer app: the third app from the same code and the same
 * backend as Waggle Gig and Waggle Business, and the same accounts. Home shows
 * what delivers to the customer in Food and Shop (Send and Drive open on their
 * dates); a shop's page, basket and checkout, and live tracking, work with or
 * without an account.
 */
export default function WaggleApp() {
  const initSession = useAuthStore((s) => s.initSession);
  useEffect(() => { void initSession(); }, [initSession]);
  return (
    <>
      <Toasts />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/auth" element={<AuthScreen redirectTo="/account" />} />
        <Route path="/shop/:id" element={<ShopPage />} />
        <Route path="/order/:token" element={<TrackPage />} />
        <Route path="/group/:token" element={<GroupPage />} />
        <Route path="/send" element={<SendPage />} />
        <Route path="/send/:token" element={<SendTrackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
