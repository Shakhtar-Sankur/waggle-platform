import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Tied to the company, not the product: a Play Store package name can never
  // be changed after publication, so this has to survive any future rename of
  // the app itself. It was com.masayaako.driver — an identifier left over from
  // a name the app has not carried for months.
  appId: "com.gigzen.waggle",
  appName: "Waggle",
  webDir: "dist",
  bundledWebRuntime: false,
  plugins: {
    Geolocation: {
      permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      // The brand indigo. This was still #ff4400 from the orange identity, so
      // every notification tinted itself a colour the app no longer uses.
      iconColor: "#4F46E5",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
