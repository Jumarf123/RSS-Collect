#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const LAUNCHABLE_EXTENSIONS: &[&str] = &["exe", "bat", "cmd"];

#[derive(Clone, Debug)]
struct ToolDescriptor {
    id: String,
    title: String,
    folder_path: PathBuf,
    targets: Vec<TargetDescriptor>,
}

#[derive(Clone, Debug)]
struct TargetDescriptor {
    id: String,
    label: String,
    file_name: String,
    path: PathBuf,
    kind: LaunchKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LaunchKind {
    Executable,
    Batch,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolEntry {
    id: String,
    title: String,
    has_targets: bool,
    requires_choice: bool,
    targets: Vec<LaunchTarget>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchTarget {
    id: String,
    label: String,
    file_name: String,
}

#[tauri::command]
fn list_tools(app: AppHandle) -> Result<Vec<ToolEntry>, String> {
    scan_tools(&app)
        .map(|tools| {
            tools
                .into_iter()
                .map(|tool| ToolEntry {
                    id: tool.id,
                    title: tool.title,
                    has_targets: !tool.targets.is_empty(),
                    requires_choice: tool.targets.len() > 1,
                    targets: tool
                        .targets
                        .into_iter()
                        .map(|target| LaunchTarget {
                            id: target.id,
                            label: target.label,
                            file_name: target.file_name,
                        })
                        .collect(),
                })
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_tool_folder(app: AppHandle, tool_id: String) -> Result<(), String> {
    let tool = scan_tools(&app)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|tool| tool.id == tool_id)
        .ok_or_else(|| "Tool not found".to_string())?;

    Command::new("explorer.exe")
        .arg(&tool.folder_path)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn launch_tool(app: AppHandle, tool_id: String, target_id: Option<String>) -> Result<(), String> {
    let tool = scan_tools(&app)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|tool| tool.id == tool_id)
        .ok_or_else(|| "Tool not found".to_string())?;

    let target = match (tool.targets.len(), target_id.as_deref()) {
        (0, _) => return Err("Tool has no launch targets".to_string()),
        (1, None) => tool.targets[0].clone(),
        (_, Some(target_id)) => tool
            .targets
            .iter()
            .find(|target| target.id == target_id)
            .cloned()
            .ok_or_else(|| "Target not found".to_string())?,
        _ => return Err("Launch target is required".to_string()),
    };

    launch_target(&target).map_err(|error| error.to_string())
}

fn launch_target(target: &TargetDescriptor) -> Result<(), String> {
    let folder = target
        .path
        .parent()
        .ok_or_else(|| "Launch folder not found".to_string())?;

    let mut command = match target.kind {
        LaunchKind::Executable => Command::new(&target.path),
        LaunchKind::Batch => {
            let mut command = Command::new("cmd.exe");
            command.arg("/C").arg("call").arg(&target.file_name);
            #[cfg(target_os = "windows")]
            command.creation_flags(CREATE_NO_WINDOW);
            command
        }
    };

    command.current_dir(folder);
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

fn scan_tools(app: &AppHandle) -> Result<Vec<ToolDescriptor>, String> {
    let tools_root = tools_root(app)?;
    let entries = fs::read_dir(&tools_root).map_err(|error| error.to_string())?;
    let mut tools = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().trim().to_string();
        if folder_name.is_empty() {
            continue;
        }

        let targets = if folder_name.eq_ignore_ascii_case("zapret") {
            collect_zapret_targets(&path)
        } else {
            collect_regular_targets(&path)?
        };

        tools.push(ToolDescriptor {
            id: folder_name.to_lowercase(),
            title: folder_name,
            folder_path: path,
            targets,
        });
    }

    tools.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(tools)
}

fn collect_zapret_targets(folder: &Path) -> Vec<TargetDescriptor> {
    (1..=6)
        .filter_map(|index| {
            let file_name = format!("{index}.bat");
            let path = folder.join(&file_name);

            if !path.is_file() {
                return None;
            }

            Some(TargetDescriptor {
                id: index.to_string(),
                label: index.to_string(),
                file_name,
                path,
                kind: LaunchKind::Batch,
            })
        })
        .collect()
}

fn collect_regular_targets(folder: &Path) -> Result<Vec<TargetDescriptor>, String> {
    let mut targets = Vec::new();
    let entries = fs::read_dir(folder).map_err(|error| error.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !path.is_file() || !is_launchable(&path) {
            continue;
        }

        let file_name = file_name(&path)?;
        let extension = extension(&path);
        let kind = if extension.eq_ignore_ascii_case("exe") {
            LaunchKind::Executable
        } else {
            LaunchKind::Batch
        };

        let label = path
            .file_stem()
            .unwrap_or_else(|| OsStr::new(&file_name))
            .to_string_lossy()
            .to_string();

        targets.push(TargetDescriptor {
            id: file_name.to_lowercase(),
            label,
            file_name,
            path,
            kind,
        });
    }

    targets.sort_by(|left, right| {
        left.file_name
            .to_lowercase()
            .cmp(&right.file_name.to_lowercase())
    });
    Ok(targets)
}

fn tools_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("tools");
        if bundled.is_dir() {
            return Ok(bundled);
        }
    }

    let workspace_tools = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Workspace root not found".to_string())?
        .join("tools");

    if workspace_tools.is_dir() {
        return Ok(workspace_tools);
    }

    let current_tools = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join("tools");

    if current_tools.is_dir() {
        return Ok(current_tools);
    }

    Err("tools directory not found".to_string())
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or_else(|| "File name not found".to_string())
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_string()
}

fn is_launchable(path: &Path) -> bool {
    let extension = extension(path);
    LAUNCHABLE_EXTENSIONS
        .iter()
        .any(|item| item.eq_ignore_ascii_case(&extension))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_tools,
            launch_tool,
            open_tool_folder
        ])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}

#[cfg(test)]
mod tests {
    use super::{collect_regular_targets, collect_zapret_targets};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_case_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("valid time")
            .as_nanos();

        let path = std::env::temp_dir().join(format!("rss_collector_{name}_{suffix}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn regular_targets_are_detected_and_sorted() {
        let folder = temp_case_dir("regular");
        fs::write(folder.join("BTool.exe"), []).expect("write exe");
        fs::write(folder.join("a-tool.bat"), []).expect("write bat");
        fs::write(folder.join("ignore.txt"), []).expect("write text");

        let targets = collect_regular_targets(&folder).expect("targets");
        let file_names = targets
            .iter()
            .map(|target| target.file_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(file_names, vec!["a-tool.bat", "BTool.exe"]);

        fs::remove_dir_all(folder).expect("cleanup");
    }

    #[test]
    fn zapret_targets_only_include_numbered_batches() {
        let folder = temp_case_dir("zapret");
        fs::write(folder.join("1.bat"), []).expect("write first");
        fs::write(folder.join("3.bat"), []).expect("write third");
        fs::write(folder.join("service.bat"), []).expect("write service");

        let targets = collect_zapret_targets(&folder);
        let labels = targets
            .iter()
            .map(|target| target.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["1", "3"]);

        fs::remove_dir_all(folder).expect("cleanup");
    }
}
