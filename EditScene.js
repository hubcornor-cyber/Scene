let currentWizardIndex = 0;
let playbackInterval = null;
let isPlaying = false;
let currentPlaybackTime = 0;
let currentGeneratedCSV = "";

window.projectState = {
    version: 1,
    projectName: "Studio Production Export",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canvas: { width: 1920, height: 1080 },
    transcription: "",
    audio: { name: "", type: "", dataUrl: "", duration: 0 },
    settings: {
        readingSpeed: 2.5,
        minimumSceneDuration: 2.0,
        sceneGap: 0.15,
        defaultTransition: "cut",
        includeEmbeddedAssets: true
    },
    scenes: []
};

function initApp() {
    initEventHandlers();
    loadProjectFromLocalStorage();
    refreshUI();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

function initEventHandlers() {
    const parseBtn = document.getElementById("btnParseTranscription");
    if (parseBtn) {
        parseBtn.addEventListener("click", (e) => {
            e.preventDefault();
            parseTextPhase();
        });
    } else {
        console.error("btnParseTranscription not found");
    }

    const fileTranscription = document.getElementById("fileTranscription");
    if (fileTranscription) fileTranscription.addEventListener("change", handleTranscriptionFile);

    setupDragDrop("dropzoneTranscription", (txt) => {
        const ta = document.getElementById("txtTranscription");
        if (ta) ta.value = txt;
    }, "text");

    const fileAudio = document.getElementById("fileAudio");
    if (fileAudio) fileAudio.addEventListener("change", handleAudioFile);

    const btnProcessAudio = document.getElementById("btnProcessAudio");
    if (btnProcessAudio) btnProcessAudio.addEventListener("click", () => switchStep(3));

    setupDragDrop("dropzoneAudio", (file) => loadAudioBuffer(file), "file");

    const btnPrevWizardScene = document.getElementById("btnPrevWizardScene");
    if (btnPrevWizardScene) btnPrevWizardScene.addEventListener("click", () => navigateWizard(-1));

    const btnNextWizardScene = document.getElementById("btnNextWizardScene");
    if (btnNextWizardScene) btnNextWizardScene.addEventListener("click", () => navigateWizard(1));

    const btnClearSceneAssets = document.getElementById("btnClearSceneAssets");
    if (btnClearSceneAssets) btnClearSceneAssets.addEventListener("click", clearFocusedAssets);

    const inputBgFile = document.getElementById("inputBgFile");
    if (inputBgFile) inputBgFile.addEventListener("change", (e) => uploadAssetToFocused(e, "bg"));

    const inputPngFile = document.getElementById("inputPngFile");
    if (inputPngFile) inputPngFile.addEventListener("change", (e) => uploadAssetToFocused(e, "png"));

    const inputOverlayFile = document.getElementById("inputOverlayFile");
    if (inputOverlayFile) inputOverlayFile.addEventListener("change", (e) => uploadAssetToFocused(e, "overlay"));

    const btnRecalculateTiming = document.getElementById("btnRecalculateTiming");
    if (btnRecalculateTiming) {
        btnRecalculateTiming.addEventListener("click", () => {
            if (confirm("Recalculate timing thresholds? Manual overrides will be modified.")) {
                runLocalAIClockAllocation();
            }
        });
    }

    const btnExportJSON = document.getElementById("btnExportJSON");
    if (btnExportJSON) btnExportJSON.addEventListener("click", exportProjectJSONFile);

    const fileImportJSON = document.getElementById("fileImportJSON");
    if (fileImportJSON) fileImportJSON.addEventListener("change", importProjectJSONFile);

    const btnBuildCSV = document.getElementById("btnBuildCSV");
    if (btnBuildCSV) btnBuildCSV.addEventListener("click", compileStateToCSV);

    const btnDownloadCSV = document.getElementById("btnDownloadCSV");
    if (btnDownloadCSV) btnDownloadCSV.addEventListener("click", triggerCSVFileDownload);

    const btnCopyCSV = document.getElementById("btnCopyCSV");
    if (btnCopyCSV) btnCopyCSV.addEventListener("click", copyCSVStringToClipboard);

    const fileImportCSV = document.getElementById("fileImportCSV");
    if (fileImportCSV) fileImportCSV.addEventListener("change", importSequenceFromCSVFile);

    const btnNewProject = document.getElementById("btnNewProject");
    if (btnNewProject) btnNewProject.addEventListener("click", purgeWorkspaceAndReset);

    const btnSaveProject = document.getElementById("btnSaveProject");
    if (btnSaveProject) btnSaveProject.addEventListener("click", saveProjectToLocalStorage);

    const btnTimelinePlay = document.getElementById("btnTimelinePlay");
    if (btnTimelinePlay) btnTimelinePlay.addEventListener("click", toggleStudioPlayback);

    const btnTimelineFullscreen = document.getElementById("btnTimelineFullscreen");
    if (btnTimelineFullscreen) {
        btnTimelineFullscreen.addEventListener("click", () => {
            const canvas = document.getElementById("studioCanvas");
            if (canvas) canvas.requestFullscreen().catch(() => {});
        });
    }

    document.querySelectorAll(".step").forEach(stepEl => {
        stepEl.addEventListener("click", () => {
            const stepNum = parseInt(stepEl.getAttribute("data-step"), 10);
            if (window.projectState.scenes.length > 0 || stepNum <= 2) {
                switchStep(stepNum);
            }
        });
    });

    bindInspectorInputMutations();
}

function setupDragDrop(id, callback, type = "text") {
    const dz = document.getElementById(id);
    if (!dz) return;

    dz.addEventListener("dragover", (e) => {
        e.preventDefault();
        dz.classList.add("hover");
    });

    dz.addEventListener("dragleave", () => dz.classList.remove("hover"));

    dz.addEventListener("drop", (e) => {
        e.preventDefault();
        dz.classList.remove("hover");
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            if (type === "text") {
                const r = new FileReader();
                r.onload = (ev) => callback(ev.target.result);
                r.readAsText(files[0]);
            } else {
                callback(files[0]);
            }
        }
    });
}

function switchStep(stepNum) {
    document.querySelectorAll(".wizard-panel").forEach(p => p.classList.add("hidden"));
    document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));

    const panel = document.getElementById(`panelStep${stepNum}`);
    const step = document.querySelector(`.step[data-step="${stepNum}"]`);

    if (panel) panel.classList.remove("hidden");
    if (step) step.classList.add("active");

    if (stepNum === 3) {
        renderWizardSidebar();
        syncWizardFocusedScene();
    }

    if (stepNum === 4) {
        initTimelineStudioView();
        drawStudioFrame();
    }
}

function handleTranscriptionFile(e) {
    if (e.target.files.length > 0) {
        const r = new FileReader();
        r.onload = (ev) => {
            const ta = document.getElementById("txtTranscription");
            if (ta) ta.value = ev.target.result;
        };
        r.readAsText(e.target.files[0]);
    }
}

function parseTextPhase() {
    const rawText = (document.getElementById("txtTranscription")?.value || "").trim();
    if (!rawText) {
        displayAlert("Please input standard transcription data strings first.");
        return;
    }

    window.projectState.transcription = rawText;

  const lines = rawText
    .split(/\r?\n+/)
    .map(l => l.replace(/^(🔢|🕒|▶|🤖)\s*/g, "").trim())
    .filter(l => l.length > 0);
    

    window.projectState.scenes = lines.map((line, idx) => ({
        scene_id: `scene_${idx + 1}`,
        line_number: idx + 1,
        transcription: line,
        visual_description: "",
        background_file: "",
        background_data_url: "",
        png_file: "",
        png_data_url: "",
        overlay_file: "",
        overlay_data_url: "",
        start_time: 0,
        end_time: 0,
        duration: 0,
        transition: "cut",
        text_position: "bottom",
        text_color: "#ffffff",
        text_size: 42,
        text_alignment: "center",
        background_fit: "cover",
        png_x: 480,
        png_y: 270,
        png_width: 960,
        png_height: 540,
        overlay_x: 0,
        overlay_y: 0,
        overlay_width: 1920,
        overlay_height: 1080,
        volume: 1.0,
        enabled: true
    }));

    runLocalAIClockAllocation();
    switchStep(2);
    refreshUI();
}

function handleAudioFile(e) {
    if (e.target.files.length > 0) loadAudioBuffer(e.target.files[0]);
}

function loadAudioBuffer(file) {
    const statusBadge = document.getElementById("audioMetadataStatus");

    if (statusBadge) {
        statusBadge.textContent = "Decoding audio binary, please stand by...";
        statusBadge.classList.remove("hidden");
    }

    const r = new FileReader();
    r.onload = (ev) => {
        window.projectState.audio.name = file.name;
        window.projectState.audio.type = file.type;
        window.projectState.audio.dataUrl = ev.target.result;

        const audioEl = new Audio();
        audioEl.src = ev.target.result;

        audioEl.onloadedmetadata = () => {
            window.projectState.audio.duration = audioEl.duration;

            if (statusBadge) {
                statusBadge.className = "metadata-badge loaded";
                statusBadge.textContent = `🎵 Audio Node Loaded: ${file.name} [${audioEl.duration.toFixed(2)}s]`;
            }

            const btnProcessAudio = document.getElementById("btnProcessAudio");
            if (btnProcessAudio) btnProcessAudio.removeAttribute("disabled");

            runLocalAIClockAllocation();
            refreshUI();
        };

        audioEl.onerror = () => {
            displayAlert("Failed to decode audio track structural properties safely.");
            if (statusBadge) statusBadge.classList.add("hidden");
        };
    };

    r.readAsDataURL(file);
}

function runLocalAIClockAllocation() {
    const count = window.projectState.scenes.length;
    if (count === 0) return;

    const totalDuration = window.projectState.audio.duration > 0
        ? window.projectState.audio.duration
        : (count * 3.5);

    const standardBlock = totalDuration / count;

    window.projectState.scenes.forEach((scene, index) => {
        scene.start_time = Number((index * standardBlock).toFixed(3));
        scene.end_time = Number(((index + 1) * standardBlock).toFixed(3));
        scene.duration = Number((scene.end_time - scene.start_time).toFixed(3));
    });

    if (!document.getElementById("panelStep4")?.classList.contains("hidden")) {
        initTimelineStudioView();
    }

    refreshUI();
}

function renderWizardSidebar() {
    const list = document.getElementById("sceneMiniList");
    if (!list) return;

    list.innerHTML = "";
    window.projectState.scenes.forEach((scene, idx) => {
        const item = document.createElement("div");
        item.className = `mini-item ${idx === currentWizardIndex ? "active" : ""}`;
        item.textContent = `Row ${scene.line_number}: ${scene.transcription.substring(0, 30)}...`;
        item.onclick = () => {
            currentWizardIndex = idx;
            syncWizardFocusedScene();
        };
        list.appendChild(item);
    });

    const progress = document.getElementById("sceneWizardProgress");
    if (progress) progress.textContent = `${currentWizardIndex + 1} / ${window.projectState.scenes.length}`;
}

function syncWizardFocusedScene() {
    if (window.projectState.scenes.length === 0) return;
    renderWizardSidebar();

    const scene = window.projectState.scenes[currentWizardIndex];
    if (!scene) return;

    const idEl = document.getElementById("lblFocusedSceneId");
    const textEl = document.getElementById("lblFocusedText");
    const inputDesc = document.getElementById("inputVisualDesc");
    const bg = document.getElementById("previewBgBox");
    const png = document.getElementById("previewPngBox");
    const overlay = document.getElementById("previewOverlayBox");

    if (idEl) idEl.textContent = `Scene Line #${scene.line_number}`;
    if (textEl) textEl.textContent = `"${scene.transcription}"`;
    if (inputDesc) inputDesc.value = scene.visual_description || "";
    if (bg) bg.textContent = scene.background_file ? `🖼 ${scene.background_file}` : "No Background Asset Linked";
    if (png) png.textContent = scene.png_file ? `🎭 ${scene.png_file}` : "No Overlay Linked";
    if (overlay) overlay.textContent = scene.overlay_file ? `📦 ${scene.overlay_file}` : "No Foreground Object Linked";
}

function navigateWizard(dir) {
    if (dir === 1 && document.getElementById("chkApplyToAll")?.checked) {
        applyFocusedAssetsToAllRemaining();
    }

    currentWizardIndex += dir;
    if (currentWizardIndex < 0) currentWizardIndex = 0;

    if (currentWizardIndex >= window.projectState.scenes.length) {
        currentWizardIndex = window.projectState.scenes.length - 1;
        switchStep(4);
    } else {
        syncWizardFocusedScene();
    }
}

function applyFocusedAssetsToAllRemaining() {
    const source = window.projectState.scenes[currentWizardIndex];
    for (let i = currentWizardIndex + 1; i < window.projectState.scenes.length; i++) {
        window.projectState.scenes[i].background_file = source.background_file;
        window.projectState.scenes[i].background_data_url = source.background_data_url;
        window.projectState.scenes[i].png_file = source.png_file;
        window.projectState.scenes[i].png_data_url = source.png_data_url;
        window.projectState.scenes[i].overlay_file = source.overlay_file;
        window.projectState.scenes[i].overlay_data_url = source.overlay_data_url;
        window.projectState.scenes[i].visual_description = source.visual_description;
    }
    displayAlert("Assets replicated down the remaining track successfully.", false);
}

function clearFocusedAssets() {
    const scene = window.projectState.scenes[currentWizardIndex];
    if (!scene) return;

    scene.background_file = "";
    scene.background_data_url = "";
    scene.png_file = "";
    scene.png_data_url = "";
    scene.overlay_file = "";
    scene.overlay_data_url = "";

    syncWizardFocusedScene();
}

function uploadAssetToFocused(e, layerType) {
    const file = e.target.files[0];
    if (!file) return;

    const r = new FileReader();
    r.onload = (ev) => {
        const s = window.projectState.scenes[currentWizardIndex];
        if (!s) return;

        if (layerType === "bg") {
            s.background_file = file.name;
            s.background_data_url = ev.target.result;
        }

        if (layerType === "png") {
            s.png_file = file.name;
            s.png_data_url = ev.target.result;
        }

        if (layerType === "overlay") {
            s.overlay_file = file.name;
            s.overlay_data_url = ev.target.result;
        }

        syncWizardFocusedScene();
        refreshUI();
    };

    r.readAsDataURL(file);
}

function initTimelineStudioView() {
    const track = document.getElementById("sceneBlocksTrack");
    const ruler = document.getElementById("timelineRuler");
    if (!track || !ruler) return;

    track.innerHTML = "";
    ruler.innerHTML = "";

    const totalTime = window.projectState.audio.duration > 0 ? window.projectState.audio.duration : 30;
    const pxPerSec = 40;

    track.style.width = `${totalTime * pxPerSec}px`;
    ruler.style.width = `${totalTime * pxPerSec}px`;

    for (let i = 0; i <= totalTime; i += 5) {
        const tick = document.createElement("span");
        tick.className = "time-tick";
        tick.style.left = `${i * pxPerSec}px`;
        tick.textContent = `${i}s`;
        ruler.appendChild(tick);
    }

    window.projectState.scenes.forEach((scene, index) => {
        const block = document.createElement("div");
        block.className = "scene-block-slice";
        block.style.left = `${scene.start_time * pxPerSec}px`;
        block.style.width = `${scene.duration * pxPerSec}px`;
        block.innerHTML = `<div class="block-title">#${scene.line_number}</div><div class="block-sub">${scene.transcription}</div>`;
        block.addEventListener("click", (e) => {
            e.stopPropagation();
            inspectSceneIndex(index);
        });
        track.appendChild(block);
    });

    track.onclick = (e) => {
        const rect = track.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        currentPlaybackTime = clickX / pxPerSec;
        if (currentPlaybackTime > totalTime) currentPlaybackTime = totalTime;
        updatePlayheadPosition();
        drawStudioFrame();
    };

    updatePlayheadPosition();
}

function updatePlayheadPosition() {
    const pxPerSec = 40;
    const playhead = document.getElementById("timelinePlayhead");
    if (playhead) playhead.style.left = `${currentPlaybackTime * pxPerSec}px`;

    const timeLabel = document.getElementById("txtTimelineTime");
    if (timeLabel) {
        timeLabel.textContent = `${currentPlaybackTime.toFixed(2)}s / ${(window.projectState.audio.duration || 0).toFixed(2)}s`;
    }
}

function inspectSceneIndex(idx) {
    const empty = document.getElementById("inspectorEmptyState");
    const content = document.getElementById("inspectorContent");

    if (empty) empty.classList.add("hidden");
    if (content) content.classList.remove("hidden");

    const scene = window.projectState.scenes[idx];
    if (!scene) return;

    const sceneIndex = document.getElementById("inspSceneIndex");
    const start = document.getElementById("inspStart");
    const end = document.getElementById("inspEnd");
    const bgFit = document.getElementById("inspBgFit");
    const transition = document.getElementById("inspTransition");
    const textPos = document.getElementById("inspTextPos");
    const textColor = document.getElementById("inspTextColor");
    const pngX = document.getElementById("inspPngX");
    const pngY = document.getElementById("inspPngY");

    if (sceneIndex) sceneIndex.value = idx;
    if (start) start.value = scene.start_time;
    if (end) end.value = scene.end_time;
    if (bgFit) bgFit.value = scene.background_fit;
    if (transition) transition.value = scene.transition;
    if (textPos) textPos.value = scene.text_position;
    if (textColor) textColor.value = scene.text_color;
    if (pngX) pngX.value = scene.png_x;
    if (pngY) pngY.value = scene.png_y;

    document.querySelectorAll(".scene-block-slice").forEach((b, i) => {
        b.classList.toggle("selected", i === idx);
    });

    currentPlaybackTime = scene.start_time;
    updatePlayheadPosition();
    drawStudioFrame();
}

function bindInspectorInputMutations() {
    const fields = ["inspStart", "inspEnd", "inspBgFit", "inspTransition", "inspTextPos", "inspTextColor", "inspPngX", "inspPngY"];

    fields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.addEventListener("input", () => {
            const idx = parseInt(document.getElementById("inspSceneIndex")?.value, 10);
            if (isNaN(idx)) return;

            const s = window.projectState.scenes[idx];
            if (!s) return;

            s.start_time = Number(document.getElementById("inspStart")?.value || 0);
            s.end_time = Number(document.getElementById("inspEnd")?.value || 0);
            s.duration = Number((s.end_time - s.start_time).toFixed(3));
            s.background_fit = document.getElementById("inspBgFit")?.value || s.background_fit;
            s.transition = document.getElementById("inspTransition")?.value || s.transition;
            s.text_position = document.getElementById("inspTextPos")?.value || s.text_position;
            s.text_color = document.getElementById("inspTextColor")?.value || s.text_color;
            s.png_x = parseInt(document.getElementById("inspPngX")?.value || "0", 10);
            s.png_y = parseInt(document.getElementById("inspPngY")?.value || "0", 10);

            initTimelineStudioView();
            drawStudioFrame();
        });
    });
}

function drawStudioFrame() {
    const canvas = document.getElementById("studioCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#111116";
    ctx.fillRect(0, 0, 1920, 1080);

    const scene = window.projectState.scenes.find(s => currentPlaybackTime >= s.start_time && currentPlaybackTime <= s.end_time);
    if (!scene) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "bold 40px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Outside Defined Sequence Boundaries", 960, 540);
        return;
    }

    const renderVisualLayer = (dataUrl, x = 0, y = 0, w = 1920, h = 1080, fit = "none") => {
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => {
            if (fit === "cover") {
                const scale = Math.max(1920 / img.width, 1080 / img.height);
                const nw = img.width * scale, nh = img.height * scale;
                ctx.drawImage(img, (1920 - nw) / 2, (1080 - nh) / 2, nw, nh);
            } else if (fit === "contain") {
                const scale = Math.min(1920 / img.width, 1080 / img.height);
                const nw = img.width * scale, nh = img.height * scale;
                ctx.drawImage(img, (1920 - nw) / 2, (1080 - nh) / 2, nw, nh);
            } else if (fit === "stretch") {
                ctx.drawImage(img, 0, 0, 1920, 1080);
            } else {
                ctx.drawImage(img, x, y, w, h);
            }
        };
        img.src = dataUrl;
    };

    if (scene.background_data_url) renderVisualLayer(scene.background_data_url, 0, 0, 1920, 1080, scene.background_fit);
    if (scene.png_data_url) renderVisualLayer(scene.png_data_url, scene.png_x, scene.png_y, 960, 540);
    if (scene.overlay_data_url) renderVisualLayer(scene.overlay_data_url, 0, 0, 1920, 1080);

    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    let textY = 950;
    if (scene.text_position === "center") textY = 540;
    if (scene.text_position === "top") textY = 150;
    ctx.fillRect(160, textY - 60, 1600, 90);

    ctx.fillStyle = scene.text_color || "#ffffff";
    ctx.font = "bold 44px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scene.transcription, 960, textY - 15);
}

function toggleStudioPlayback() {
    const btn = document.getElementById("btnTimelinePlay");
    const maxDuration = window.projectState.audio.duration || 30;

    if (isPlaying) {
        isPlaying = false;
        if (btn) btn.textContent = "▶";
        clearInterval(playbackInterval);
    } else {
        if (currentPlaybackTime >= maxDuration) currentPlaybackTime = 0;
        isPlaying = true;
        if (btn) btn.textContent = "⏸";
        const tickRate = 30;
        playbackInterval = setInterval(() => {
            currentPlaybackTime += tickRate / 1000;
            if (currentPlaybackTime >= maxDuration) {
                currentPlaybackTime = maxDuration;
                toggleStudioPlayback();
            }
            updatePlayheadPosition();
            drawStudioFrame();
        }, tickRate);
    }
}

function compileStateToCSV() {
    const embed = true;
    const headers = [
        "scene_id", "line_number", "transcription", "visual_description",
        "background_file", "background_data_url", "png_file", "png_data_url",
        "overlay_file", "overlay_data_url", "start_time", "end_time", "duration",
        "transition", "text_position", "text_color", "text_size", "text_alignment",
        "background_fit", "png_x", "png_y", "png_width", "png_height",
        "overlay_x", "overlay_y", "overlay_width", "overlay_height", "volume", "enabled"
    ];

    let csvLines = [headers.join(",")];

    window.projectState.scenes.forEach(s => {
        const row = [
            s.scene_id,
            s.line_number,
            `"${(s.transcription || "").replace(/"/g, '""')}"`,
            `"${(s.visual_description || "").replace(/"/g, '""')}"`,
            s.background_file || "",
            embed ? (s.background_data_url || "") : "",
            s.png_file || "",
            embed ? (s.png_data_url || "") : "",
            s.overlay_file || "",
            embed ? (s.overlay_data_url || "") : "",
            s.start_time,
            s.end_time,
            s.duration,
            s.transition,
            s.text_position,
            s.text_color,
            s.text_size,
            s.text_alignment,
            s.background_fit,
            s.png_x,
            s.png_y,
            s.png_width,
            s.png_height,
            s.overlay_x,
            s.overlay_y,
            s.overlay_width,
            s.overlay_height,
            s.volume,
            s.enabled ? 1 : 0
        ];
        csvLines.push(row.join(","));
    });

    currentGeneratedCSV = csvLines.join("\n");
    
    document.getElementById("btnDownloadCSV")?.removeAttribute("disabled");
    document.getElementById("btnCopyCSV")?.removeAttribute("disabled");
    displayAlert("CSV data matrix structure created successfully.", false);
}

function triggerCSVFileDownload() {
    if (!currentGeneratedCSV) return;
    const blob = new Blob([currentGeneratedCSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project-scenes.csv";
    a.click();
    URL.revokeObjectURL(url);
}

function copyCSVStringToClipboard() {
    if (!currentGeneratedCSV) return;
    navigator.clipboard.writeText(currentGeneratedCSV).then(() => {
        displayAlert("CSV contents copied directly to system clipboard.", false);
    });
}

function importSequenceFromCSVFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const r = new FileReader();
    r.onload = (ev) => {
        const raw = ev.target.result;
const rows = raw.split(/\r?\n/).map(row => row.trim()).filter(row => row.length > 0);
        
        if (rows.length < 2) {
            displayAlert("Invalid CSV structural configuration target.");
            return;
        }

        const lines = rows.slice(1).map((row, i) => {
            const c = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            return {
                scene_id: c[0] || `scene_${i + 1}`,
                line_number: parseInt(c[1]) || i + 1,
                transcription: (c[2] || `Line ${i + 1}`).replace(/^"|"$/g, "").replace(/""/g, '"'),
                visual_description: (c[3] || "").replace(/^"|"$/g, "").replace(/""/g, '"'),
                background_file: c[4] || "",
                background_data_url: c[5] || "",
                png_file: c[6] || "",
                png_data_url: c[7] || "",
                overlay_file: c[8] || "",
                overlay_data_url: c[9] || "",
                start_time: parseFloat(c[10]) || 0,
                end_time: parseFloat(c[11]) || 0,
                duration: parseFloat(c[12]) || 0,
                transition: c[13] || "cut",
                text_position: c[14] || "bottom",
                text_color: c[15] || "#ffffff",
                text_size: parseInt(c[16]) || 42,
                text_alignment: c[17] || "center",
                background_fit: c[18] || "cover",
                png_x: parseInt(c[19]) || 480,
                png_y: parseInt(c[20]) || 270,
                png_width: parseInt(c[21]) || 960,
                png_height: parseInt(c[22]) || 540,
                overlay_x: parseInt(c[23]) || 0,
                overlay_y: parseInt(c[24]) || 0,
                overlay_width: parseInt(c[25]) || 1920,
                overlay_height: parseInt(c[26]) || 1080,
                volume: parseFloat(c[27]) || 1,
                enabled: (c[28] || "1") === "1"
            };
        });

        window.projectState.scenes = lines;
        displayAlert("CSV sequence state tree synchronized safely into workspace.", false);
        initTimelineStudioView();
        refreshUI();
    };
    r.readAsText(file);
}

function refreshUI() {
    const scenesCount = document.getElementById("telScenesCount");
    const audioStatus = document.getElementById("telAudioStatus");
    const duration = document.getElementById("telDuration");
    const missingAssets = document.getElementById("telMissingAssets");

    if (scenesCount) scenesCount.textContent = window.projectState.scenes.length;
    if (audioStatus) audioStatus.textContent = window.projectState.audio.name ? "Connected" : "Missing Track";
    if (duration) duration.textContent = `${(window.projectState.audio.duration || 0).toFixed(2)}s`;

    let missingCount = 0;
    window.projectState.scenes.forEach(s => { if (!s.background_data_url) missingCount++; });

    if (missingAssets) {
        missingAssets.textContent = missingCount > 0
            ? `${missingCount} Scenes Missing Images`
            : "Fully Packaged Layout Status Active";
    }
}

function exportProjectJSONFile() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.projectState));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "studio_project_backup.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function importProjectJSONFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const r = new FileReader();
    r.onload = (ev) => {
        try {
            const parsed = JSON.parse(ev.target.result);
            if (parsed.scenes) {
                window.projectState = parsed;
                displayAlert("JSON metadata state tree loaded successfully.", false);
                refreshUI();
                if (window.projectState.scenes.length > 0) switchStep(4);
            }
        } catch (err) {
            displayAlert("Malformed JSON verification tracking signature properties.");
        }
    };
    r.readAsText(file);
}

function saveProjectToLocalStorage() {
    try {
        localStorage.setItem("studio_project_state", JSON.stringify(window.projectState));
        displayAlert("Workspace cached directly to browser storage layer.", false);
    } catch (e) {
        displayAlert("Data footprint size limits exceeded. Export via standard backup JSON instead.");
    }
}

function loadProjectFromLocalStorage() {
    const cached = localStorage.getItem("studio_project_state");
    if (cached) {
        try {
            window.projectState = JSON.parse(cached);
        } catch (e) {}
    }
}

function purgeWorkspaceAndReset() {
    if (confirm("Confirm destructive erasure sequence step actions?")) {
        localStorage.removeItem("studio_project_state");
        window.location.reload();
    }
}

function displayAlert(text, isError = true) {
    const target = isError ? document.getElementById("errorAlert") : document.getElementById("successAlert");
    if (!target) return;

    target.textContent = text;
    target.classList.remove("hidden");
    setTimeout(() => target.classList.add("hidden"), 6000);
}
