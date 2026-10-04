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
