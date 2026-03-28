const APP_MANIFEST: &str = include_str!("app.manifest");

fn main() {
    let windows = if std::env::var("PROFILE").as_deref() == Ok("release") {
        tauri_build::WindowsAttributes::new()
            .window_icon_path("icons/rss.ico")
            .app_manifest(APP_MANIFEST)
    } else {
        tauri_build::WindowsAttributes::new_without_app_manifest().window_icon_path("icons/rss.ico")
    };

    let attributes = tauri_build::Attributes::new().windows_attributes(windows);

    tauri_build::try_build(attributes).expect("failed to run tauri build helpers");
}
