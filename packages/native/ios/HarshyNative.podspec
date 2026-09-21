Pod::Spec.new do |s|
  s.name           = 'HarshyNative'
  s.version        = '0.1.0'
  s.summary        = 'Native GPS and IMU engine for Harshy driving analysis'
  s.description    = 'Standalone CoreLocation + CoreMotion collector with an Expo module bridge.'
  s.author         = 'Harshy'
  s.homepage       = 'https://github.com/harshy'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.frameworks = 'CoreLocation', 'CoreMotion'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
