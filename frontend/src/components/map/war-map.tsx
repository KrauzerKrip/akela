import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import "ol/ol.css";
import Map from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import { fromExtent as polygonFromExtent } from "ol/geom/Polygon";
import { Projection, addProjection } from "ol/proj";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import ImageLayer from "ol/layer/Image";
import ImageStatic from "ol/source/ImageStatic";
import { Circle as CircleStyle, Fill, Icon, Stroke, Style } from "ol/style";
import type { ProjectedState, SessionManifest } from "../../types/events";
import { getMapCropUrl } from "../../api/client";
import { Skeleton } from "../ui/skeleton";
import { useWarRoomStore } from "../../store/war-room-store";

interface WarMapProps {
  projectedState: ProjectedState;
  manifest: SessionManifest | null;
}

const MAX_CROP_SPAN_METERS = 10_000;
const MAX_REASONABLE_COORDINATE = 1_000_000;
const CROP_PADDING_METERS = 0;//2_000;
const FIT_PADDING_PX = 24;
const CTRL_WHEEL_ZOOM_STEP = 0.5;
const ZOOM_LEVEL_RANGE = 8;

const PROJECTION = new Projection({
  code: "AKELA-CARTESIAN",
  units: "m",
  global: false,
});
addProjection(PROJECTION);

function createNatoIcon(color: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <rect x="3" y="3" width="20" height="20" fill="${color}" stroke="#ffffff" stroke-width="2" />
    </svg>`
  )}`;
}

const FRIEND_STYLE = new Style({
  image: new Icon({
    src: createNatoIcon("#2563eb"),
    scale: 1,
  }),
});
const ENEMY_STYLE = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: "#dc2626" }),
    stroke: new Stroke({ color: "#fee2e2", width: 1 }),
  }),
});
const CURRENT_TASK_ROUTE_STYLE = new Style({
  stroke: new Stroke({ color: "#f59e0b", width: 2.5 }),
});

const PLANNED_TASK_ROUTE_STYLE = new Style({
  stroke: new Stroke({ color: "#f97316", width: 2, lineDash: [6, 5] }),
});

type CropBox = { x1: number; y1: number; x2: number; y2: number };
type CropExtent = [number, number, number, number];

function cropToExtent(crop: CropBox): CropExtent {
  return [crop.x1, crop.y1, crop.x2, crop.y2];
}

function extentToCrop(extent: CropExtent): CropBox {
  return { x1: extent[0], y1: extent[1], x2: extent[2], y2: extent[3] };
}

function getAspectRatioAdjustedExtent(crop: CropBox, imageWidth: number, imageHeight: number): CropExtent {
  const targetWidth = crop.x2 - crop.x1;
  const targetHeight = crop.y2 - crop.y1;
  const imageAspect = imageWidth / imageHeight;
  const targetAspect = targetWidth / targetHeight;

  if (!Number.isFinite(imageAspect) || imageAspect <= 0 || Math.abs(imageAspect - targetAspect) < 1e-6) {
    return cropToExtent(crop);
  }

  const centerY = (crop.y1 + crop.y2) / 2;
  const adjustedHeight = targetWidth / imageAspect;
  const halfHeight = adjustedHeight / 2;
  return [crop.x1, centerY - halfHeight, crop.x2, centerY + halfHeight];
}

function loadImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        return;
      }
      resolve(null);
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function remapPointToDisplayCrop(
  point: [number, number],
  sourceCrop: CropBox,
  displayCrop: CropBox,
): [number, number] {
  const sourceWidth = sourceCrop.x2 - sourceCrop.x1;
  const sourceHeight = sourceCrop.y2 - sourceCrop.y1;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return point;
  }

  const xRatio = (point[0] - sourceCrop.x1) / sourceWidth;
  const yRatio = (point[1] - sourceCrop.y1) / sourceHeight;
  return [
    displayCrop.x1 + xRatio * (displayCrop.x2 - displayCrop.x1),
    displayCrop.y1 + yRatio * (displayCrop.y2 - displayCrop.y1),
  ];
}

function constrainViewToCrop(map: Map, crop: CropBox, resetView: boolean): void {
  const view = map.getView();
  const size = map.getSize();
  const extent = cropToExtent(crop);

  if (size) {
    const fitWidth = Math.max(1, size[0] - FIT_PADDING_PX * 2);
    const fitHeight = Math.max(1, size[1] - FIT_PADDING_PX * 2);
    const fitResolution = Math.max((crop.x2 - crop.x1) / fitWidth, (crop.y2 - crop.y1) / fitHeight);
    const fitZoom = view.getZoomForResolution(fitResolution);

    if (fitZoom !== undefined && Number.isFinite(fitZoom)) {
      const maxZoom = fitZoom + ZOOM_LEVEL_RANGE;
      const currentZoom = view.getZoom();

      view.setMinZoom(fitZoom);
      view.setMaxZoom(maxZoom);

      if (resetView || currentZoom == null || currentZoom < fitZoom) {
        view.setZoom(fitZoom);
      } else if (currentZoom > maxZoom) {
        view.setZoom(maxZoom);
      }
    }
  }

  if (resetView) {
    view.setCenter([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]);
  }
}

function applyCtrlWheelZoom(view: View, deltaY: number): void {
  const currentZoom = view.getZoom() ?? view.getMinZoom();
  const direction = deltaY < 0 ? 1 : -1;
  const requestedZoom = currentZoom + direction * CTRL_WHEEL_ZOOM_STEP;
  const nextZoom = view.getConstrainedZoom(requestedZoom, direction);

  if (nextZoom === undefined || Math.abs(nextZoom - currentZoom) < Number.EPSILON) {
    return;
  }

  view.setZoom(nextZoom);
}

function normalizeBox(box: CropBox): CropBox | null {
  const values = [box.x1, box.y1, box.x2, box.y2];
  if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_REASONABLE_COORDINATE)) {
    return null;
  }
  const x1 = Math.min(box.x1, box.x2);
  const x2 = Math.max(box.x1, box.x2);
  const y1 = Math.min(box.y1, box.y2);
  const y2 = Math.max(box.y1, box.y2);
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x1, y1, x2, y2 };
}

function clampSpan(box: CropBox, maxSpan: number): CropBox {
  const width = box.x2 - box.x1;
  const height = box.y2 - box.y1;
  let { x1, y1, x2, y2 } = box;
  if (width > maxSpan) {
    const centerX = (x1 + x2) / 2;
    x1 = centerX - maxSpan / 2;
    x2 = centerX + maxSpan / 2;
  }
  if (height > maxSpan) {
    const centerY = (y1 + y2) / 2;
    y1 = centerY - maxSpan / 2;
    y2 = centerY + maxSpan / 2;
  }
  return { x1, y1, x2, y2 };
}

function buildCenteredCrop(workingArea: CropBox): CropBox {
  const centerX = (workingArea.x1 + workingArea.x2) / 2;
  const centerY = (workingArea.y1 + workingArea.y2) / 2;
  const width = Math.min(workingArea.x2 - workingArea.x1 + CROP_PADDING_METERS * 2, MAX_CROP_SPAN_METERS);
  const height = Math.min(workingArea.y2 - workingArea.y1 + CROP_PADDING_METERS * 2, MAX_CROP_SPAN_METERS);
  return {
    x1: centerX - width / 2,
    y1: centerY - height / 2,
    x2: centerX + width / 2,
    y2: centerY + height / 2,
  };
}

export function WarMap({ projectedState, manifest }: WarMapProps): JSX.Element {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<Map | null>(null);
  const imageLayerRef = useRef<ImageLayer<ImageStatic> | null>(null);
  const vectorSourceRef = useRef(new VectorSource());
  const desiredCropRef = useRef<CropBox | null>(null);
  const displayCropRef = useRef<CropBox | null>(null);
  const [displayCrop, setDisplayCrop] = useState<CropBox | null>(null);
  const setLoadingMap = useWarRoomStore((state) => state.setLoadingMap);
  const loadingMap = useWarRoomStore((state) => state.loadingMap);

  const worldName = manifest?.intelInput?.area?.world ?? "Altis";
  const workingArea = useMemo<CropBox | null>(() => {
    const area = manifest?.intelInput?.area;
    if (!area || [area.x1, area.y1, area.x2, area.y2].some((entry) => typeof entry !== "number")) {
      return null;
    }
    const normalized = normalizeBox({
      x1: area.x1 as number,
      y1: area.y1 as number,
      x2: area.x2 as number,
      y2: area.y2 as number,
    });
    return normalized;
  }, [manifest?.intelInput?.area]);
  const desiredCrop = useMemo(
    () => (workingArea ? clampSpan(buildCenteredCrop(workingArea), MAX_CROP_SPAN_METERS) : null),
    [workingArea],
  );

  useEffect(() => {
    desiredCropRef.current = desiredCrop;
  }, [desiredCrop]);

  useEffect(() => {
    displayCropRef.current = displayCrop;
  }, [displayCrop]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) {
      return;
    }

    const vectorLayer = new VectorLayer({
      source: vectorSourceRef.current,
      zIndex: 100,
    });

    const target = mapRef.current;
    const initialCrop = desiredCropRef.current;
    const map = new Map({
      target,
      layers: [vectorLayer],
      view: new View({
        projection: PROJECTION,
        center: initialCrop
          ? [(initialCrop.x1 + initialCrop.x2) / 2, (initialCrop.y1 + initialCrop.y2) / 2]
          : [0, 0],
        extent: initialCrop ? [initialCrop.x1, initialCrop.y1, initialCrop.x2, initialCrop.y2] : undefined,
        zoom: 1,
        minZoom: 0,
        maxZoom: ZOOM_LEVEL_RANGE,
      }),
      controls: [],
    });

    mapInstance.current = map;

    const handleCtrlWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      applyCtrlWheelZoom(map.getView(), event.deltaY);
    };

    target.addEventListener("wheel", handleCtrlWheel, { capture: true, passive: false });

    const el = target;
    const resizeObserver =
      el &&
      new ResizeObserver(() => {
        map.updateSize();
        const crop = displayCropRef.current ?? desiredCropRef.current;
        if (crop) {
          constrainViewToCrop(map, crop, false);
        }
      });
    if (el && resizeObserver) {
      resizeObserver.observe(el);
    }

    return () => {
      resizeObserver?.disconnect();
      target.removeEventListener("wheel", handleCtrlWheel, { capture: true });
      map.setTarget(undefined);
      mapInstance.current = null;
      imageLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !desiredCrop) {
      setDisplayCrop(null);
      setLoadingMap(false);
      return;
    }

    let cancelled = false;
    const cropForRequest = desiredCrop;
    const map = mapInstance.current;

    setLoadingMap(true);
    const mapUrl = getMapCropUrl(worldName, cropForRequest);

    const updateSource = async () => {
      const dimensions = await loadImageDimensions(mapUrl);
      if (cancelled) {
        return;
      }

      const imageExtent = dimensions
        ? getAspectRatioAdjustedExtent(cropForRequest, dimensions.width, dimensions.height)
        : cropToExtent(cropForRequest);
      const nextDisplayCrop = extentToCrop(imageExtent);
      setDisplayCrop(nextDisplayCrop);

      const source = new ImageStatic({
        url: mapUrl,
        projection: PROJECTION,
        imageExtent,
      });

      source.on("imageloadstart", () => setLoadingMap(true));
      source.on("imageloadend", () => setLoadingMap(false));
      source.on("imageloaderror", () => setLoadingMap(false));

      if (!imageLayerRef.current) {
        imageLayerRef.current = new ImageLayer({ source, zIndex: 1 });
        map.getLayers().insertAt(0, imageLayerRef.current);
      } else {
        imageLayerRef.current.setSource(source);
      }

      map.updateSize();
      constrainViewToCrop(map, nextDisplayCrop, true);
    };

    void updateSource();

    return () => {
      cancelled = true;
    };
  }, [desiredCrop, setLoadingMap, worldName]);

  useEffect(() => {
    if (!workingArea) {
      vectorSourceRef.current.clear();
      return;
    }
    if (!desiredCrop || !displayCrop) {
      return;
    }
    const source = vectorSourceRef.current;
    source.clear();

    const remap = (point: [number, number]) =>
      remapPointToDisplayCrop(point, desiredCrop, displayCrop);

    const remappedWorkingArea = {
      x1: remapPointToDisplayCrop([workingArea.x1, workingArea.y1], desiredCrop, displayCrop)[0],
      y1: remapPointToDisplayCrop([workingArea.x1, workingArea.y1], desiredCrop, displayCrop)[1],
      x2: remapPointToDisplayCrop([workingArea.x2, workingArea.y2], desiredCrop, displayCrop)[0],
      y2: remapPointToDisplayCrop([workingArea.x2, workingArea.y2], desiredCrop, displayCrop)[1],
    };

    const areaPolygon = new Feature({
      geometry: polygonFromExtent([
        remappedWorkingArea.x1,
        remappedWorkingArea.y1,
        remappedWorkingArea.x2,
        remappedWorkingArea.y2,
      ]),
    });
    areaPolygon.setStyle(
      new Style({
        stroke: new Stroke({ color: "#94a3b8", width: 2, lineDash: [8, 6] }),
      })
    );
    source.addFeature(areaPolygon);

    projectedState.groups.forEach((group) => {
      const feature = new Feature({
        geometry: new Point(remap(group.position)),
      });
      feature.setStyle(FRIEND_STYLE);
      source.addFeature(feature);

    });

    projectedState.currentTaskRoutes.forEach((route) => {
      if (route.points.length < 2) {
        return;
      }
      const arrow = new Feature({
        geometry: new LineString(route.points.map(remap)),
      });
      arrow.setStyle(CURRENT_TASK_ROUTE_STYLE);
      source.addFeature(arrow);
    });

    projectedState.plannedTaskRoutes.forEach((route) => {
      if (route.points.length < 2) {
        return;
      }
      const arrow = new Feature({
        geometry: new LineString(route.points.map(remap)),
      });
      arrow.setStyle(PLANNED_TASK_ROUTE_STYLE);
      source.addFeature(arrow);
    });

    projectedState.contacts.forEach((contact) => {
      const feature = new Feature({
        geometry: new Point(remap(contact.position)),
      });
      feature.setStyle(ENEMY_STYLE);
      source.addFeature(feature);
    });
  }, [
    projectedState.contacts,
    projectedState.currentTaskRoutes,
    projectedState.groups,
    projectedState.plannedTaskRoutes,
    desiredCrop,
    displayCrop,
    workingArea,
  ]);

  return (
    <section className="relative h-full min-h-0 border-r border-zinc-800 bg-zinc-900">
      {loadingMap ? <Skeleton className="absolute inset-0 z-10" /> : null}
      <div ref={mapRef} className="h-full w-full" />
    </section>
  );
}
