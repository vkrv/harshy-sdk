const {
  withAndroidManifest,
  withInfoPlist,
  AndroidConfig,
} = require("expo/config-plugins");

const SERVICE_NAME = "com.harshy.engine.TripForegroundService";

/** Keep MainActivity alive across rotation / density / locale so a trip cannot double-allocate. */
const MAIN_ACTIVITY_CONFIG_CHANGES = [
  "keyboard",
  "keyboardHidden",
  "orientation",
  "screenLayout",
  "screenSize",
  "smallestScreenSize",
  "uiMode",
  "locale",
  "layoutDirection",
  "fontScale",
  "density",
  "colorMode",
  "fontWeightAdjustment",
  "grammaticalGender",
];

function mergeConfigChanges(activity) {
  if (!activity?.$) {
    return;
  }
  const current = String(activity.$["android:configChanges"] ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  const next = new Set(current);
  for (const item of MAIN_ACTIVITY_CONFIG_CHANGES) {
    next.add(item);
  }
  activity.$["android:configChanges"] = MAIN_ACTIVITY_CONFIG_CHANGES.concat(
    [...next].filter((item) => !MAIN_ACTIVITY_CONFIG_CHANGES.includes(item)),
  ).join("|");
}

function withHarshyNative(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.WAKE_LOCK",
    "android.permission.ACTIVITY_RECOGNITION",
  ]);

  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    const services = application.service ?? [];
    const exists = services.some(
      (service) => service.$?.["android:name"] === SERVICE_NAME,
    );
    if (!exists) {
      services.push({
        $: {
          "android:name": SERVICE_NAME,
          "android:exported": "false",
          "android:foregroundServiceType": "location",
          "android:stopWithTask": "false",
        },
      });
    } else {
      for (const service of services) {
        if (service.$?.["android:name"] === SERVICE_NAME) {
          service.$["android:stopWithTask"] = "false";
          service.$["android:foregroundServiceType"] = "location";
        }
      }
    }
    application.service = services;
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    mergeConfigChanges(activity);
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    plist.NSLocationWhenInUseUsageDescription =
      plist.NSLocationWhenInUseUsageDescription ??
      "Harshy measures speed and path to score driving quality.";
    plist.NSLocationAlwaysAndWhenInUseUsageDescription =
      plist.NSLocationAlwaysAndWhenInUseUsageDescription ??
      "Harshy continues measuring driving quality while the screen is off.";
    plist.NSMotionUsageDescription =
      plist.NSMotionUsageDescription ??
      "Harshy uses motion sensors to detect harsh acceleration, braking, and cornering.";
    const modes = new Set(plist.UIBackgroundModes ?? []);
    modes.add("location");
    plist.UIBackgroundModes = [...modes];
    return mod;
  });

  return config;
}

module.exports = withHarshyNative;
