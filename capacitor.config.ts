import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Three apps from one codebase. CAP_FLAVOR=business or CAP_FLAVOR=waggle (set by
 * scripts/cap-flavor.mjs) points the Capacitor CLI at Waggle Business or the
 * Waggle customer app: each has its own package name, web build and Android
 * project, so all three sit on one phone and are separate Play listings.
 */
const business = process.env.CAP_FLAVOR === "business";
const waggle = process.env.CAP_FLAVOR === "waggle";

const config: CapacitorConfig = waggle
  ? {
      // The customer app. Permanent once published, like the other two.
      appId: "com.gigzen.waggle.app",
      appName: "Waggle",
      webDir: "dist-waggle",
      android: { path: "android-waggle" },
      plugins: {
        Geolocation: {
          permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
        },
        LocalNotifications: {
          iconColor: "#4F46E5",
        },
      },
    }
  : business
  ? {
      // Permanent once published, like the Gig's: a Play package name can never change.
      appId: "com.gigzen.waggle.business",
      appName: "Waggle Business",
      webDir: "dist-business",
      android: { path: "android-business" },
      plugins: {
        Geolocation: {
          permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
        },
        LocalNotifications: {
          iconColor: "#312E81",
        },
      },
    }
  : {
      // Tied to the company, not the product: a Play Store package name can never
      // be changed after publication, so this has to survive any future rename of
      // the app itself. It was com.masayaako.driver — an identifier left over from
      // a name the app has not carried for months.
      appId: "com.gigzen.waggle",
      appName: "Waggle Gig",
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
