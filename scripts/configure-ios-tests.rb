require 'xcodeproj'
path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
app = project.targets.find { |t| t.name == 'App' }
tests = project.targets.find { |t| t.name == 'AppUITests' }
unless tests
  tests = project.new_target(:ui_test_bundle, 'AppUITests', :ios, '16.0')
  tests.add_dependency(app)
  group = project.main_group.new_group('AppUITests', 'AppUITests')
  tests.add_file_references([group.new_file('GameUITests.swift')])
  tests.resources_build_phase.add_file_reference(group.new_file('qualifying-history.json'))
  tests.build_configurations.each do |config|
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'jp.shunpei1130.nekotsubushi.uitests'
    config.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
    config.build_settings['PRODUCT_MODULE_NAME'] = 'AppUITests'
    config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
    config.build_settings['TEST_TARGET_NAME'] = 'App'
    config.build_settings['SWIFT_VERSION'] = '5.0'
    config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  end
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.set_launch_target(app)
scheme.save_as(path, 'App', true)
