#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 前端的接口请求经由原生 HTTP 发出，不受 WebView 跨域限制
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running multi-chat");
}
