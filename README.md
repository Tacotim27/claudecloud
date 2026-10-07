# claudecloud

A 3D model of a house built with [Three.js](https://threejs.org/).

It has a gabled roof, door with step, framed windows, a round attic window, a brick
chimney with drifting smoke, a stepping-stone path, bushes, and two trees, with
real-time shadows.

## Run it

There is no build step. Three.js is loaded from a CDN through an import map, so the
page only needs to be served over HTTP (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Drag to orbit, scroll to zoom, right-drag to pan.

## Files

- `index.html`: page shell and import map
- `main.js`: scene, house geometry, lighting and render loop

## Low-poly figure (`threeJS/`)

A flat-shaded, low-poly character recreated from a front reference image: red hair
with a pointed fringe, side locks and a braid down the back, a white shirt with a
folded collar and black tie, high-waisted black trousers and brown shoes. Every
part is built in code from lofted cross-sections; the face (eyes, brows, nose
shading, mouth) is painted onto a canvas texture projected from the front.

Serve the repo as above and open http://localhost:8000/threeJS/. Add `?view=face`,
`?view=side`, `?view=back` or `?view=three` to start from another angle; double-click
returns to the front view.

- `threeJS/index.html`: page shell and import map
- `threeJS/main.js`: geometry helpers, figure parts, face texture and lighting
