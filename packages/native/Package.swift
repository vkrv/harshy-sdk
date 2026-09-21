// swift-tools-version: 5.9
import PackageDescription

/// Full native iOS client (CoreLocation / CoreMotion). Used by non-Expo hosts.
/// Pure math / RoadStamp CI tests live in `HarshyMath/Package.swift` (macOS-friendly).
let package = Package(
  name: "Harshy",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "Harshy", targets: ["Harshy"]),
  ],
  targets: [
    .target(
      name: "Harshy",
      path: "ios",
      exclude: [
        "HarshyNativeModule.swift",
        "HarshyNative.podspec",
      ],
      linkerSettings: [
        .linkedFramework("CoreLocation"),
        .linkedFramework("CoreMotion"),
        .linkedFramework("UIKit"),
      ]
    ),
  ]
)
