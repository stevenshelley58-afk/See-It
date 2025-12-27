import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_ARCHITECTURE = {
  nodes: [
    {
      id: "merchant",
      label: "Merchant Admin",
      type: "actor",
      x: -80,
      y: 120,
      z: 220,
      description: "Configures products + settings in Shopify admin.",
    },
    {
      id: "shopper",
      label: "Shopper",
      type: "actor",
      x: 80,
      y: 120,
      z: 220,
      description: 'Uses the "See it in your room" storefront experience.',
    },

    {
      id: "productsUI",
      label: "/app/products",
      type: "ui",
      x: -160,
      y: 60,
      z: 110,
      description: "Admin UI for preparing product assets.",
      code: "<Link to=\"/app/products\">Products</Link>",
    },
    {
      id: "settingsUI",
      label: "/app/settings",
      type: "ui",
      x: -40,
      y: 30,
      z: 110,
      description: "Plans, quota, and defaults.",
      code: "<Link to=\"/app/settings\">Settings</Link>",
    },
    {
      id: "storefrontModal",
      label: "Storefront Modal",
      type: "ui",
      x: 160,
      y: 70,
      z: 110,
      description: "Embedded UI (theme extension) shown to shoppers.",
    },
    {
      id: "roomUploadUI",
      label: "Room Upload + Mask",
      type: "ui",
      x: 200,
      y: 0,
      z: 110,
      description: "Upload room photo + paint a removal mask.",
      code: "mask_data_url | mask_image_key",
    },
    {
      id: "resultUI",
      label: "Result Viewer",
      type: "ui",
      x: 160,
      y: -80,
      z: 110,
      description: "Displays the cleaned / composited output.",
    },

    {
      id: "prepareAPI",
      label: "Prepare API",
      type: "logic",
      x: -170,
      y: 60,
      z: 0,
      description: "Creates/updates ProductAsset and kicks off processing.",
      code: "POST /api/products/prepare",
    },
    {
      id: "bgPipeline",
      label: "Prep Pipeline",
      type: "logic",
      x: -60,
      y: 20,
      z: 0,
      description: "download → convert → bg-remove → upload.",
      code: "prepareProduct(...)",
    },
    {
      id: "preparedProxy",
      label: "Prepared Proxy",
      type: "logic",
      x: 40,
      y: 70,
      z: 0,
      description: "Serves prepared asset to storefront extension.",
      code: "GET /app-proxy/product.prepared",
    },
    {
      id: "cleanupProxy",
      label: "Room Cleanup",
      type: "logic",
      x: 150,
      y: 0,
      z: 0,
      description: "Validates, rate-limits, then calls Gemini cleanup.",
      code: "POST /app-proxy/room/cleanup",
    },
    {
      id: "renderProxy",
      label: "Render Polling",
      type: "logic",
      x: 110,
      y: -60,
      z: 0,
      description: "Polls a job and returns signed output URL.",
      code: "GET /app-proxy/render/:jobId",
    },

    {
      id: "prisma",
      label: "Prisma DB",
      type: "data",
      x: 0,
      y: 70,
      z: -110,
      description: "Shop + ProductAsset + RenderJob.",
      data: "{ Shop, ProductAsset, RenderJob }",
    },
    {
      id: "preparedAsset",
      label: "Prepared Asset",
      type: "data",
      x: -80,
      y: -10,
      z: -110,
      description: "Prepared product image URL and status.",
      data: "{ status, preparedImageUrl }",
    },
    {
      id: "roomSession",
      label: "Room Session",
      type: "data",
      x: 90,
      y: -10,
      z: -110,
      description: "Room image + mask source + quality settings.",
      data: "{ room_session_id, mask, quality }",
    },
    {
      id: "renderJob",
      label: "Render Job",
      type: "data",
      x: 50,
      y: -80,
      z: -110,
      description: "Async job status and output URL.",
      data: "{ id, status, outputUrl }",
    },

    {
      id: "shopify",
      label: "Shopify",
      type: "external",
      x: -210,
      y: 90,
      z: -220,
      description: "Admin GraphQL + CDN image hosting.",
    },
    {
      id: "imgly",
      label: "IMG.LY",
      type: "external",
      x: -120,
      y: -60,
      z: -220,
      description: "Background removal for product prep.",
    },
    {
      id: "gcs",
      label: "GCS Bucket",
      type: "external",
      x: 0,
      y: -120,
      z: -220,
      description: "Stores prepared assets and render outputs (signed URLs).",
    },
    {
      id: "gemini",
      label: "Gemini AI",
      type: "external",
      x: 160,
      y: -120,
      z: -220,
      description: "Object removal for room cleanup.",
    },
  ],

  connections: [
    { from: "merchant", to: "productsUI", label: "uses" },
    { from: "merchant", to: "settingsUI", label: "configures" },

    { from: "productsUI", to: "prepareAPI", label: "POST" },
    { from: "prepareAPI", to: "bgPipeline", label: "runs" },
    { from: "bgPipeline", to: "shopify", label: "downloads" },
    { from: "bgPipeline", to: "imgly", label: "bg-remove" },
    { from: "bgPipeline", to: "gcs", label: "uploads" },
    { from: "prepareAPI", to: "prisma", label: "updates" },
    { from: "prisma", to: "preparedAsset", label: "stores" },

    { from: "shopper", to: "storefrontModal", label: "opens" },
    { from: "storefrontModal", to: "preparedProxy", label: "GET" },
    { from: "preparedProxy", to: "preparedAsset", label: "reads" },
    { from: "preparedProxy", to: "storefrontModal", label: "returns" },

    { from: "storefrontModal", to: "roomUploadUI", label: "continues" },
    { from: "roomUploadUI", to: "cleanupProxy", label: "POST" },
    { from: "cleanupProxy", to: "roomSession", label: "validates" },
    { from: "cleanupProxy", to: "gemini", label: "requests" },
    { from: "gemini", to: "gcs", label: "writes" },
    { from: "cleanupProxy", to: "renderJob", label: "creates" },
    { from: "renderJob", to: "renderProxy", label: "polled by" },
    { from: "renderProxy", to: "gcs", label: "reads" },
    { from: "renderProxy", to: "resultUI", label: "returns" },
  ],

  flowPath: [
    "shopper",
    "storefrontModal",
    "preparedProxy",
    "preparedAsset",
    "roomUploadUI",
    "cleanupProxy",
    "roomSession",
    "gemini",
    "gcs",
    "renderJob",
    "renderProxy",
    "resultUI",
  ],
};

function getNodeColor(type) {
  const colors = {
    actor: 0x6366f1,
    ui: 0x22c55e,
    logic: 0xec4899,
    data: 0x06b6d4,
    external: 0xf59e0b,
  };
  return colors[type] || 0x6b7280;
}

function getNodeColorHex(type) {
  const colors = {
    actor: "#6366f1",
    ui: "#22c55e",
    logic: "#ec4899",
    data: "#06b6d4",
    external: "#f59e0b",
  };
  return colors[type] || "#6b7280";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry?.dispose) child.geometry.dispose();
    const material = child.material;
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach((m) => m?.dispose?.());
      return;
    }
    material.dispose?.();
  });
}

export function CodeArchitecture3D({ architecture = DEFAULT_ARCHITECTURE }) {
  const containerRef = useRef(null);
  const threeRef = useRef(null);

  const [selectedNode, setSelectedNode] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const nodesRef = useRef({});
  const linesRef = useRef([]);
  const particlesRef = useRef([]);

  const flowIntervalRef = useRef(null);
  const timeoutIdsRef = useRef([]);
  const rafIdRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const dragDistanceRef = useRef(0);
  const rotationRef = useRef({ x: 0.3, y: 0 });

  const nodeById = useMemo(() => {
    const map = new Map();
    for (const node of architecture.nodes) map.set(node.id, node);
    return map;
  }, [architecture.nodes]);

  useEffect(() => {
    let canceled = false;

    const init = async () => {
      const container = containerRef.current;
      if (!container) return;

      const THREE = await import("three");
      if (canceled) return;

      threeRef.current = THREE;

      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0f);
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
      camera.position.set(0, 50, 500);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      const pointLight = new THREE.PointLight(0xffffff, 1);
      pointLight.position.set(200, 200, 200);
      scene.add(pointLight);

      const nodes = {};
      for (const node of architecture.nodes) {
        const color = getNodeColor(node.type);
        const geometry = new THREE.SphereGeometry(node.type === "actor" ? 20 : 15, 32, 32);
        const material = new THREE.MeshPhongMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.2,
          transparent: true,
          opacity: 0.9,
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.set(node.x, node.y, node.z);
        sphere.userData = { nodeId: node.id, type: "node" };
        scene.add(sphere);
        nodes[node.id] = sphere;

        const glowGeometry = new THREE.SphereGeometry(node.type === "actor" ? 25 : 20, 32, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.15,
          depthWrite: false,
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.copy(sphere.position);
        scene.add(glow);
      }
      nodesRef.current = nodes;

      const lines = [];
      for (const conn of architecture.connections) {
        const fromNode = nodeById.get(conn.from);
        const toNode = nodeById.get(conn.to);
        if (!fromNode || !toNode) continue;

        const points = [
          new THREE.Vector3(fromNode.x, fromNode.y, fromNode.z),
          new THREE.Vector3(toNode.x, toNode.y, toNode.z),
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: 0x4b5563,
          transparent: true,
          opacity: 0.4,
        });
        const line = new THREE.Line(geometry, material);
        line.userData = { from: conn.from, to: conn.to, type: "link" };
        scene.add(line);
        lines.push(line);
      }
      linesRef.current = lines;

      const planeGeometry = new THREE.PlaneGeometry(420, 360);
      const layers = [
        { z: 110, label: "UI Layer", color: 0x22c55e },
        { z: 0, label: "Logic Layer", color: 0xec4899 },
        { z: -110, label: "Data Layer", color: 0x06b6d4 },
        { z: -220, label: "External Layer", color: 0xf59e0b },
      ];
      for (const layer of layers) {
        const material = new THREE.MeshBasicMaterial({
          color: layer.color,
          transparent: true,
          opacity: 0.02,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(planeGeometry, material);
        plane.position.z = layer.z;
        scene.add(plane);
      }

      const animate = () => {
        rafIdRef.current = requestAnimationFrame(animate);

        if (!isDraggingRef.current) rotationRef.current.y += 0.002;
        scene.rotation.x = rotationRef.current.x;
        scene.rotation.y = rotationRef.current.y;

        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const particle = particlesRef.current[i];
          particle.progress += particle.speed;
          if (particle.progress < 1) {
            const pos = particle.start.clone().lerp(particle.end, particle.progress);
            particle.mesh.position.copy(pos);
            continue;
          }

          scene.remove(particle.mesh);
          disposeObject(particle.mesh);
          particlesRef.current.splice(i, 1);
        }

        renderer.render(scene, camera);
      };
      animate();

      const resize = () => {
        const el = containerRef.current;
        if (!el) return;
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };

      resizeObserverRef.current = new ResizeObserver(resize);
      resizeObserverRef.current.observe(container);
    };

    init();

    return () => {
      canceled = true;

      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (flowIntervalRef.current) clearInterval(flowIntervalRef.current);
      for (const timeoutId of timeoutIdsRef.current) clearTimeout(timeoutId);
      timeoutIdsRef.current = [];

      resizeObserverRef.current?.disconnect();

      const renderer = rendererRef.current;
      if (renderer) {
        const container = containerRef.current;
        if (container?.contains(renderer.domElement)) container.removeChild(renderer.domElement);
        renderer.dispose();
      }

      if (sceneRef.current) disposeObject(sceneRef.current);
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      nodesRef.current = {};
      linesRef.current = [];
      particlesRef.current = [];
    };
  }, [architecture.connections, architecture.nodes, nodeById]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pickNode = (event) => {
      const THREE = threeRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      if (!THREE || !camera || !scene) return;

      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObjects(scene.children, true);
      const nodeHit = intersects.find((i) => i.object?.userData?.type === "node");
      if (!nodeHit) return;

      const node = nodeById.get(nodeHit.object.userData.nodeId);
      if (node) setSelectedNode(node);
    };

    const onPointerDown = (event) => {
      isDraggingRef.current = true;
      setIsDragging(true);
      dragDistanceRef.current = 0;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      container.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!isDraggingRef.current) return;
      const deltaX = event.clientX - lastPointerRef.current.x;
      const deltaY = event.clientY - lastPointerRef.current.y;
      dragDistanceRef.current += Math.abs(deltaX) + Math.abs(deltaY);

      rotationRef.current.y += deltaX * 0.005;
      rotationRef.current.x += deltaY * 0.005;
      rotationRef.current.x = clamp(rotationRef.current.x, -Math.PI / 3, Math.PI / 3);
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      container.releasePointerCapture?.(event.pointerId);

      if (dragDistanceRef.current < 6) pickNode(event);
    };

    const onWheel = (event) => {
      event.preventDefault();
      const camera = cameraRef.current;
      if (!camera) return;
      camera.position.z += event.deltaY * 0.5;
      camera.position.z = clamp(camera.position.z, 200, 800);
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("wheel", onWheel);
    };
  }, [nodeById]);

  const startDataFlow = useCallback(() => {
    if (isAnimating || flowIntervalRef.current) return;
    const THREE = threeRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    const flowPath = architecture.flowPath || [];
    if (flowPath.length < 2) return;

    setIsAnimating(true);

    let step = 0;
    flowIntervalRef.current = setInterval(() => {
      if (!sceneRef.current) return;

      if (step >= flowPath.length - 1) {
        clearInterval(flowIntervalRef.current);
        flowIntervalRef.current = null;
        setIsAnimating(false);
        return;
      }

      const fromId = flowPath[step];
      const toId = flowPath[step + 1];
      const fromNode = nodeById.get(fromId);
      const toNode = nodeById.get(toId);

      if (fromNode && toNode) {
        const geometry = new THREE.SphereGeometry(5, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: 0x22c55e });
        const particle = new THREE.Mesh(geometry, material);
        particle.position.set(fromNode.x, fromNode.y, fromNode.z);
        scene.add(particle);

        particlesRef.current.push({
          mesh: particle,
          start: new THREE.Vector3(fromNode.x, fromNode.y, fromNode.z),
          end: new THREE.Vector3(toNode.x, toNode.y, toNode.z),
          progress: 0,
          speed: 0.02,
        });

        const line = linesRef.current.find(
          (l) => l.userData?.from === fromId && l.userData?.to === toId
        );
        if (line?.material?.color?.setHex) {
          line.material.color.setHex(0x22c55e);
          line.material.opacity = 1;
          timeoutIdsRef.current.push(
            setTimeout(() => {
              if (!line.material?.color?.setHex) return;
              line.material.color.setHex(0x4b5563);
              line.material.opacity = 0.4;
            }, 450)
          );
        }

        const fromSphere = nodesRef.current[fromId];
        const toSphere = nodesRef.current[toId];
        if (fromSphere?.material) {
          fromSphere.material.emissiveIntensity = 0.8;
          timeoutIdsRef.current.push(
            setTimeout(() => {
              if (!fromSphere?.material) return;
              fromSphere.material.emissiveIntensity = 0.2;
            }, 450)
          );
        }

        if (toSphere?.material) {
          timeoutIdsRef.current.push(
            setTimeout(() => {
              if (!toSphere?.material) return;
              toSphere.material.emissiveIntensity = 0.8;
              timeoutIdsRef.current.push(
                setTimeout(() => {
                  if (!toSphere?.material) return;
                  toSphere.material.emissiveIntensity = 0.2;
                }, 450)
              );
            }, 350)
          );
        }
      }

      step++;
    }, 600);
  }, [architecture.flowPath, isAnimating, nodeById]);

  const connectionsForSelected = useMemo(() => {
    if (!selectedNode) return [];
    return architecture.connections.filter(
      (c) => c.from === selectedNode.id || c.to === selectedNode.id
    );
  }, [architecture.connections, selectedNode]);

  return (
    <div className="w-full h-screen bg-[#0a0a0f] text-neutral-200 flex flex-col">
      <div className="px-6 py-4 border-b border-white/10 flex items-center gap-4 bg-black/30">
        <div className="text-sm font-semibold tracking-wide">
          3D Architecture — See It
        </div>

        <button
          type="button"
          onClick={startDataFlow}
          disabled={isAnimating}
          className={[
            "px-4 py-2 rounded-lg text-sm font-semibold",
            isAnimating
              ? "bg-white/10 text-neutral-400 cursor-not-allowed"
              : "bg-emerald-500 text-white hover:bg-emerald-400",
          ].join(" ")}
        >
          {isAnimating ? "Flowing…" : "Watch Data Flow"}
        </button>

        <div className="ml-auto text-xs text-neutral-400">
          Drag to rotate · Scroll to zoom · Click nodes for details
        </div>

        <div className="hidden md:flex items-center gap-3 ml-6">
          {[
            { type: "actor", label: "Actor" },
            { type: "ui", label: "UI" },
            { type: "logic", label: "Logic" },
            { type: "data", label: "Data" },
            { type: "external", label: "External" },
          ].map((item) => (
            <div key={item.type} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: getNodeColorHex(item.type) }}
              />
              <span className="text-[11px] text-neutral-400">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 relative">
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        />

        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none flex flex-col gap-10 text-right">
          {[
            { label: "Actors", color: "#6366f1", tag: "Front" },
            { label: "UI", color: "#22c55e" },
            { label: "Logic", color: "#ec4899" },
            { label: "Data", color: "#06b6d4" },
            { label: "External", color: "#f59e0b", tag: "Back" },
          ].map((layer) => (
            <div key={layer.label}>
              <div className="text-xs font-semibold" style={{ color: layer.color }}>
                {layer.label}
              </div>
              {layer.tag ? (
                <div className="text-[10px] text-neutral-600">{layer.tag}</div>
              ) : null}
            </div>
          ))}
        </div>

        {selectedNode ? (
          <div className="absolute left-5 top-5 w-[320px] bg-black/90 border border-white/10 rounded-xl p-5 backdrop-blur">
            <div className="flex items-start gap-3">
              <div
                className="w-4 h-4 rounded-full mt-1"
                style={{ background: getNodeColorHex(selectedNode.type) }}
              />
              <div className="flex-1">
                <div className="font-semibold text-base">{selectedNode.label}</div>
                <div
                  className="text-[11px] uppercase tracking-wider"
                  style={{ color: getNodeColorHex(selectedNode.type) }}
                >
                  {selectedNode.type}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="text-neutral-500 hover:text-neutral-300 text-xl leading-none -mt-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <p className="mt-3 text-sm text-neutral-300/80">{selectedNode.description}</p>

            {selectedNode.code ? (
              <div className="mt-3 p-3 rounded-lg bg-white/5 font-mono text-xs text-indigo-200">
                {selectedNode.code}
              </div>
            ) : null}

            {selectedNode.data ? (
              <div className="mt-3 p-3 rounded-lg bg-cyan-500/10 text-xs text-cyan-300">
                {selectedNode.data}
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-[11px] text-neutral-500 mb-2 tracking-wider">
                CONNECTIONS
              </div>
              <div className="flex flex-col gap-1">
                {connectionsForSelected.map((c, i) => {
                  const outgoing = c.from === selectedNode.id;
                  const otherId = outgoing ? c.to : c.from;
                  const otherNode = nodeById.get(otherId);
                  return (
                    <button
                      key={`${c.from}:${c.to}:${i}`}
                      type="button"
                      onClick={() => otherNode && setSelectedNode(otherNode)}
                      className="text-left text-xs px-2 py-1.5 rounded bg-white/5 hover:bg-white/10 flex items-center gap-2"
                    >
                      <span className="text-neutral-600">{outgoing ? "→" : "←"}</span>
                      <span style={{ color: getNodeColorHex(otherNode?.type) }}>
                        {otherNode?.label ?? otherId}
                      </span>
                      <span className="text-neutral-600 text-[10px]">({c.label})</span>
                    </button>
                  );
                })}
                {connectionsForSelected.length === 0 ? (
                  <div className="text-xs text-neutral-500">No connections.</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
