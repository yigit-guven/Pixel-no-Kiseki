# Pixel-no-Kiseki (ピクセルノキセキ)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Static Badge](https://img.shields.io/badge/Architecture-Unified_Portability-blue)](https://github.com/yigit-guven/Pixel-no-Kiseki)

**Pixel-no-Kiseki** is a high-precision browser-based pixel art editor optimized for 8-bit icons, chibi sprites, and texture assets. Engineered with a focus on stability and portability, it provides a professional-grade drawing environment.

## ✨ Key Features

- **Unified Portability Architecture**: Designed to run seamlessly in any modern environment, supporting both local `file://` protocol usage and web server hosting.
- **Robust State Management**: Built on a reactive Pub/Sub architecture that ensures perfect synchronization between user input, rendering, and UI states.
- **Precision Coordinate Engine**: Strict integer-based coordinate system prevents sub-pixel distortion and ensures razor-sharp pixel rendering at any zoom level.
- **Advanced Tools**:
  - **DDA Drawing**: Bresenham-based line drawing for perfect pixel paths.
  - **Flood Fill**: Fast, recursion-safe seed fill algorithm.
  - **Viewport Controller**: Lifecycle-aware viewport management with secondary resize stabilization.
- **PNG Workflow**: 
  - Dynamic canvas resizing with physical buffer cropping (no ghost data).
  - High-fidelity PNG import and legacy-free export.
- **Modern UI/UX**: Dark/Light mode support with glassmorphic aesthetics and Lucide icon integration.

## 🚀 Getting Started

### Local Development
The project is zero-dependency. To run it locally:
1. Clone the repository:
   ```bash
   git clone https://github.com/yigit-guven/Pixel-no-Kiseki.git
   ```
2. Open `index.html` in your favorite web browser.

### Key Bindings
- **[P]** Pencil Tool
- **[E]** Eraser Tool
- **[B]** Bucket Fill
- **[I]** Eyedropper
- **[H]** Hand Tool (Pan)
- **[C]** Center View
- **[Ctrl + Z]** Undo
- **[Ctrl + Y]** Redo

## 🏗️ Architecture Overview

The system is built on a **Modular Singleton Pattern** consolidated for portability:

1. **State Manager**: The single source of truth for the application lifecycle.
2. **Viewport Manager**: Handles the rendering pipeline, synchronization between offscreen buffers and the display canvas.
3. **Tool Controller**: Encapsulates drawing logic and algorithmic pixel manipulation.
4. **UI Controller**: Manages DOM bindings and user interaction events.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Created with ❤️ by Yigit Guven*
