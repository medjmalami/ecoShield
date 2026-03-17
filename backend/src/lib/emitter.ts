import { EventEmitter } from "events";

export const pipelineEmitter = new EventEmitter();

// Disable the default 10-listener warning — each connected SSE client adds one
// listener, so this fires legitimately with more than 10 simultaneous clients.
pipelineEmitter.setMaxListeners(0);
