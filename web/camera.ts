/**
 * RTS camera (LOG [010]): WASD + edge-scroll pan, wheel zoom-to-cursor.
 * The camera transforms the world container; it holds no sim state.
 */
import { Container } from "pixi.js";
import { screenToWorldPx } from "./coords.js";

const PAN_SPEED_PX = 900; // screen px per second at any zoom
const EDGE_MARGIN = 24;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;

export class Camera {
  readonly world: Container;
  zoom = 1;
  private readonly keys = new Set<string>();
  private mouseX = -1;
  private mouseY = -1;
  private viewW: number;
  private viewH: number;
  private readonly worldW: number;
  private readonly worldH: number;

  constructor(world: Container, viewW: number, viewH: number, worldWpx: number, worldHpx: number) {
    this.world = world;
    this.viewW = viewW;
    this.viewH = viewH;
    this.worldW = worldWpx;
    this.worldH = worldHpx;

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    window.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor));
        // Keep the world point under the cursor fixed while zooming.
        const wx = screenToWorldPx(e.clientX, this.world.x, this.zoom);
        const wy = screenToWorldPx(e.clientY, this.world.y, this.zoom);
        this.zoom = next;
        this.world.scale.set(next);
        this.world.x = e.clientX - wx * next;
        this.world.y = e.clientY - wy * next;
        this.clamp();
      },
      { passive: false },
    );
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  centerOn(worldPxX: number, worldPxY: number): void {
    this.world.x = this.viewW / 2 - worldPxX * this.zoom;
    this.world.y = this.viewH / 2 - worldPxY * this.zoom;
    this.clamp();
  }

  update(dtMs: number): void {
    const d = (PAN_SPEED_PX * dtMs) / 1000;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("w")) dy += d;
    if (this.keys.has("s")) dy -= d;
    if (this.keys.has("a")) dx += d;
    if (this.keys.has("d")) dx -= d;
    if (this.mouseX >= 0) {
      if (this.mouseX < EDGE_MARGIN) dx += d;
      if (this.mouseX > this.viewW - EDGE_MARGIN) dx -= d;
      if (this.mouseY < EDGE_MARGIN) dy += d;
      if (this.mouseY > this.viewH - EDGE_MARGIN) dy -= d;
    }
    if (dx !== 0 || dy !== 0) {
      this.world.x += dx;
      this.world.y += dy;
      this.clamp();
    }
  }

  private clamp(): void {
    // Keep at least a third of the viewport on the map.
    const w = this.worldW * this.zoom;
    const h = this.worldH * this.zoom;
    const minX = this.viewW / 3 - w;
    const maxX = this.viewW - this.viewW / 3;
    const minY = this.viewH / 3 - h;
    const maxY = this.viewH - this.viewH / 3;
    this.world.x = Math.min(maxX, Math.max(minX, this.world.x));
    this.world.y = Math.min(maxY, Math.max(minY, this.world.y));
  }
}
