// swift-tools-version: 5.9
import PackageDescription

/// macOS-friendly slice of Harshy for `swift test` (detector + RoadStamp parity with Android JUnit).
/// Sources are symlinks into `../ios` / `../Tests` so Expo/CocoaPods stay single-source.
let package = Package(
  name: "HarshyMath",
  platforms: [.macOS(.v13), .iOS(.v16)],
  products: [
    .library(name: "HarshyMath", targets: ["HarshyMath"]),
  ],
  targets: [
    .target(name: "HarshyMath"),
    .testTarget(
      name: "HarshyMathTests",
      dependencies: ["HarshyMath"]
    ),
  ]
)
