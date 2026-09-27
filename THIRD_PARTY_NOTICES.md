# Third-party notices

WaterPaint uses Spectral.js 3.0.0 for RGB-to-spectral reflectance conversion and its D65-weighted CIE color matching data. The GPU renderer integrates those data into eight bands and uses the Kubelka–Munk reflectance equation. This reduced spectral model is an approximation, not a measurement of commercial pigments.

Source: https://github.com/rvanwijnen/spectral.js

MIT License

Copyright (c) 2025 Ronald van Wijnen

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Research reference

Curtis, Anderson, Seims, Fleischer, and Salesin, *Computer-Generated Watercolor*, SIGGRAPH 1997. WaterPaint's water transport, pigment settling, paper granulation, and rewetting are independently implemented artistic approximations inspired by the paper; no research source code is included.

https://grail.cs.washington.edu/wp-content/uploads/2015/08/curtis-1997-cgw.pdf

## Other dependencies

Electron, React, electron-vite, Vite, lucide-react, fflate, and their dependencies retain their respective licenses distributed in node_modules and the packaged application. Fonts use local system fallbacks and require no network requests.
