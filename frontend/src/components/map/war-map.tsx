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

export function WarMap({ projectedState, manifest }: WarMapProps): JSX.Element {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<Map | null>(null);
  const imageLayerRef = useRef<ImageLayer<ImageStatic> | null>(null);
  const vectorSourceRef = useRef(new VectorSource());
  const currentCropRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const setLoadingMap = useWarRoomStore((state) => state.setLoadingMap);
  const loadingMap = useWarRoomStore((state) => state.loadingMap);

  const worldName = manifest?.intelInput?.area?.world ?? "Altis";
  const workingArea = useMemo(() => {
    const area = manifest?.intelInput?.area;
    if (!area || [area.x1, area.y1, area.x2, area.y2].some((entry) => typeof entry !== "number")) {
      return { x1: 0, y1: 0, x2: 3000, y2: 3000 };
    }
    return { x1: area.x1 as number, y1: area.y1 as number, x2: area.x2 as number, y2: area.y2 as number };
  }, [manifest?.intelInput?.area]);

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
        center: [(workingArea.x1 + workingArea.x2) / 2, (workingArea.y1 + workingArea.y2) / 2],
        zoom: 1,
        minZoom: 0,
        maxZoom: 8,
      }),
      controls: [],
    });

    mapInstance.current = map;
    return () => map.setTarget(undefined);
  }, [workingArea.x1, workingArea.x2, workingArea.y1, workingArea.y2]);

  useEffect(() => {
    if (!mapInstance.current) {
      return;
    }

    const crop = currentCropRef.current ?? workingArea;
    setLoadingMap(true);
    const source = new ImageStatic({
      url: getMapCropUrl(worldName, crop),
      projection: PROJECTION,
      imageExtent: [crop.x1, crop.y1, crop.x2, crop.y2],
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

    currentCropRef.current = crop;
  }, [setLoadingMap, workingArea, worldName]);

  useEffect(() => {
    if (!mapInstance.current) {
      return;
    }

    const onMoveEnd = () => {
      const extent = mapInstance.current?.getView().calculateExtent(mapInstance.current.getSize());
      const crop = currentCropRef.current;
      if (!extent || !crop) {
        return;
      }
      const [x1, y1, x2, y2] = extent;
      const outside = x1 < crop.x1 || y1 < crop.y1 || x2 > crop.x2 || y2 > crop.y2;
      if (!outside) {
        return;
      }

      const next = {
        x1: Math.min(x1, workingArea.x1),
        y1: Math.min(y1, workingArea.y1),
        x2: Math.max(x2, workingArea.x2),
        y2: Math.max(y2, workingArea.y2),
      };

      currentCropRef.current = next;
      const source = new ImageStatic({
        url: getMapCropUrl(worldName, next),
        projection: PROJECTION,
        imageExtent: [next.x1, next.y1, next.x2, next.y2],
      });
      source.on("imageloadstart", () => setLoadingMap(true));
      source.on("imageloadend", () => setLoadingMap(false));
      source.on("imageloaderror", () => setLoadingMap(false));
      imageLayerRef.current?.setSource(source);
    };

    mapInstance.current.on("moveend", onMoveEnd);
    return () => mapInstance.current?.un("moveend", onMoveEnd);
  }, [setLoadingMap, workingArea, worldName]);

  useEffect(() => {
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
  }, [projectedState.contacts, projectedState.groups, workingArea.x1, workingArea.x2, workingArea.y1, workingArea.y2]);

  return (
    <section className="relative h-full min-h-0 border-r border-zinc-800 bg-zinc-900">
      {loadingMap ? <Skeleton className="absolute inset-0 z-10" /> : null}
      <div ref={mapRef} className="h-full w-full" />
    </section>
  );
}
