# fetch-vendor.ps1 — Mirror the pinned MediaPipe CDN bundles into vendor/.
# Idempotent: re-running skips files that already exist.
# Run once per checkout before serving the demo offline.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$base = 'https://cdn.jsdelivr.net/npm'

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

        if (Test-Path $dest) {
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

Write-Host ""
Write-Host "Done. Vendor bundle at: $(Join-Path $root 'vendor\mediapipe')"
