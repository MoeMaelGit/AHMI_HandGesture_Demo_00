# fetch-vendor.ps1 — Mirror the pinned MediaPipe CDN bundles into vendor/.
# Idempotent: re-running skips files that already exist (size > 0).
# Run once per checkout before serving the demo offline.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$base = 'https://cdn.jsdelivr.net/npm'

# (1) Legacy MediaPipe solutions (Hands + camera_utils + drawing_utils).
$bundles = @(
    @{
        name    = 'hands'
        pkg     = '@mediapipe/hands@0.4.1675469240'
        files   = @(
            'hands.js',
            'hands_solution_packed_assets.data',
            'hands_solution_packed_assets_loader.js',
            'hands_solution_simd_wasm_bin.js',
            'hands_solution_simd_wasm_bin.wasm',
            'hands.binarypb',
            'hand_landmark_full.tflite',
            'hand_landmark_lite.tflite',
            'hands_solution_wasm_bin.js',
            'hands_solution_wasm_bin.wasm'
        )
    },
    @{
        name    = 'camera_utils'
        pkg     = '@mediapipe/camera_utils@0.3.1675466862'
        files   = @('camera_utils.js')
    },
    @{
        name    = 'drawing_utils'
        pkg     = '@mediapipe/drawing_utils@0.3.1675466124'
        files   = @('drawing_utils.js')
    }
)

foreach ($bundle in $bundles) {
    $destDir = Join-Path $root "vendor\mediapipe\$($bundle.name)"
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    foreach ($file in $bundle.files) {
        $url  = "$base/$($bundle.pkg)/$file"
        $dest = Join-Path $destDir $file

        if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) {
            Write-Host "  skip   $($bundle.name)/$file (already present)"
            continue
        }

        Write-Host "  fetch  $($bundle.name)/$file"
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        } catch {
            Write-Warning "  failed $($bundle.name)/$file -> $($_.Exception.Message)"
            if (Test-Path $dest) { Remove-Item $dest -Force }
        }
    }
}

# (2) MediaPipe Tasks Vision runtime (for the multi-person Pose Landmarker).
$tasksVisionPkg  = '@mediapipe/tasks-vision@0.10.35'
$tasksVisionDest = Join-Path $root 'vendor\mediapipe\tasks-vision'
$tasksVisionFiles = @(
    @{ rel = 'vision_bundle.mjs';                    sub = '' },
    @{ rel = 'wasm/vision_wasm_internal.js';         sub = 'wasm' },
    @{ rel = 'wasm/vision_wasm_internal.wasm';       sub = 'wasm' },
    @{ rel = 'wasm/vision_wasm_nosimd_internal.js';  sub = 'wasm' },
    @{ rel = 'wasm/vision_wasm_nosimd_internal.wasm'; sub = 'wasm' }
)

if (-not (Test-Path $tasksVisionDest)) {
    New-Item -ItemType Directory -Path $tasksVisionDest -Force | Out-Null
}
if (-not (Test-Path (Join-Path $tasksVisionDest 'wasm'))) {
    New-Item -ItemType Directory -Path (Join-Path $tasksVisionDest 'wasm') -Force | Out-Null
}

foreach ($f in $tasksVisionFiles) {
    $url  = "$base/$tasksVisionPkg/$($f.rel)"
    $dest = Join-Path $tasksVisionDest $f.rel

    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 0)) {
        Write-Host "  skip   tasks-vision/$($f.rel) (already present)"
        continue
    }

    Write-Host "  fetch  tasks-vision/$($f.rel)"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    } catch {
        Write-Warning "  failed tasks-vision/$($f.rel) -> $($_.Exception.Message)"
        if (Test-Path $dest) { Remove-Item $dest -Force }
    }
}

# (3) Pose Landmarker model (multi-person Pose, hosted on storage.googleapis.com).
$poseModelUrl  = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'
$poseModelDest = Join-Path $tasksVisionDest 'pose_landmarker_full.task'

if ((Test-Path $poseModelDest) -and ((Get-Item $poseModelDest).Length -gt 0)) {
    Write-Host "  skip   tasks-vision/pose_landmarker_full.task (already present)"
} else {
    Write-Host "  fetch  tasks-vision/pose_landmarker_full.task (~9 MB)"
    try {
        Invoke-WebRequest -Uri $poseModelUrl -OutFile $poseModelDest -UseBasicParsing
    } catch {
        Write-Warning "  failed pose model -> $($_.Exception.Message)"
        if (Test-Path $poseModelDest) { Remove-Item $poseModelDest -Force }
    }
}

Write-Host ""
Write-Host "Done. Vendor bundle at: $(Join-Path $root 'vendor\mediapipe')"
