"use client";

import {useEffect} from "react";
import {startTrafficCollection} from "../lib/traffic-client";

export default function TrafficCollector() {
  useEffect(() => startTrafficCollection(window, document), []);
  return null;
}
