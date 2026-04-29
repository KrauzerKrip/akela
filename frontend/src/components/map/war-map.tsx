import { useEffect, useMemo, useRef, type JSX } from "react";
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
const ARROW_STYLE = new Style({
  stroke: new Stroke({ color: "#f59e0b", width: 2, lineDash: [6, 4] }),
});

type CropBox = { x1: number; y1: number; x2: number; y2: number };

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
    if (!mapRef.current || mapInstance.current) {
      return;
    }

    const vectorLayer = new VectorLayer({
      source: vectorSourceRef.current,
      zIndex: 100,
    });

    const map = new Map({
      target: mapRef.current,
      layers: [vectorLayer],
      view: new View({
        projection: PROJECTION,
        center: desiredCrop
          ? [(desiredCrop.x1 + desiredCrop.x2) / 2, (desiredCrop.y1 + desiredCrop.y2) / 2]
          : [0, 0],
        extent: desiredCrop ? [desiredCrop.x1, desiredCrop.y1, desiredCrop.x2, desiredCrop.y2] : undefined,
        zoom: 1,
        minZoom: 0,
        maxZoom: 8,
      }),
      controls: [],
    });

    mapInstance.current = map;

    const el = mapRef.current;
    const resizeObserver =
      el &&
      new ResizeObserver(() => {
        map.updateSize();
      });
    if (el && resizeObserver) {
      resizeObserver.observe(el);
    }

    return () => {
      resizeObserver?.disconnect();
      map.setTarget(undefined);
      mapInstance.current = null;
      imageLayerRef.current = null;
    };
  }, [desiredCrop?.x1, desiredCrop?.x2, desiredCrop?.y1, desiredCrop?.y2]);

  useEffect(() => {
    if (!mapInstance.current || !desiredCrop) {
      setLoadingMap(false);
      return;
    }

    setLoadingMap(true);
    const source = new ImageStatic({
      url: getMapCropUrl(worldName, desiredCrop),
      projection: PROJECTION,
      imageExtent: [desiredCrop.x1, desiredCrop.y1, desiredCrop.x2, desiredCrop.y2],
    });

    source.on("imageloadstart", () => setLoadingMap(true));
    source.on("imageloadend", () => setLoadingMap(false));
    source.on("imageloaderror", () => setLoadingMap(false));

    if (!imageLayerRef.current) {
      imageLayerRef.current = new ImageLayer({ source, zIndex: 1 });
      mapInstance.current.getLayers().insertAt(0, imageLayerRef.current);
    } else {
      imageLayerRef.current.setSource(source);
    }
    const view = mapInstance.current.getView();
    view.setCenter([(desiredCrop.x1 + desiredCrop.x2) / 2, (desiredCrop.y1 + desiredCrop.y2) / 2]);
    view.set("extent", [desiredCrop.x1, desiredCrop.y1, desiredCrop.x2, desiredCrop.y2]);
    mapInstance.current.updateSize();
  }, [desiredCrop, setLoadingMap, worldName]);

  useEffect(() => {
    if (!workingArea) {
      vectorSourceRef.current.clear();
      return;
    }
    const source = vectorSourceRef.current;
    source.clear();

    const areaPolygon = new Feature({
      geometry: polygonFromExtent([workingArea.x1, workingArea.y1, workingArea.x2, workingArea.y2]),
    });
    areaPolygon.setStyle(
      new Style({
        stroke: new Stroke({ color: "#94a3b8", width: 2, lineDash: [8, 6] }),
      })
    );
    source.addFeature(areaPolygon);

    projectedState.groups.forEach((group) => {
      const feature = new Feature({
        geometry: new Point(group.position),
      });
      feature.setStyle(FRIEND_STYLE);
      source.addFeature(feature);

      if (group.taskDestination) {
        const arrow = new Feature({
          geometry: new LineString([group.position, group.taskDestination]),
        });
        arrow.setStyle(ARROW_STYLE);
        source.addFeature(arrow);
      }
    });

    projectedState.contacts.forEach((contact) => {
      const feature = new Feature({
        geometry: new Point(contact.position),
      });
      feature.setStyle(ENEMY_STYLE);
      source.addFeature(feature);
    });
  }, [projectedState.contacts, projectedState.groups, workingArea]);

  return (
    <section className="relative h-full min-h-0 border-r border-zinc-800 bg-zinc-900">
      {loadingMap ? <Skeleton className="absolute inset-0 z-10" /> : null}
      <div ref={mapRef} className="h-full w-full" />
    </section>
  );
}
