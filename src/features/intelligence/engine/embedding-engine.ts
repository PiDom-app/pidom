/**
 * The seam between "what a passage means" and how it is worked out.
 *
 * Everything above this file — the chunker, the job queue, retrieval, the Ask
 * screen — is written against these four functions and knows nothing about ONNX,
 * tokenizers or tensors. That is deliberate and not speculative: the ONNX path
 * is the one thing in this feature that has to be proved on a real Android
 * handset before it can be trusted, and if it has to be replaced the rest of
 * the feature must not be what gets rewritten.
 *
 * **There is no cloud implementation, and there will not be one as a
 * fallback.** A phone without the model keeps the FTS5 index it has always had
 * and the screen says which documents that costs. An engine that quietly
 * answered a different question over the network would be the failure
 * `docs/design.md` argues against for download states: a state that says one
 * thing and does another is worse than one that says it cannot.
 */
import type { Quantised } from '../retrieve/vectors';

export type EngineStatus =
  /** No model on this device. Nothing is wrong; nothing can run either. */
  | { kind: 'absent' }
  /** The files are here and verified, and the session is not open yet. */
  | { kind: 'ready' }
  /** The session is open and holding memory. */
  | { kind: 'loaded' }
  /**
   * The files are here and will not load.
   *
   * A digest that did not match, a runtime that refused the graph, or a device
   * that cannot spare the memory. Distinct from `absent` because the offer is
   * different: this one says what happened and deletes rather than downloads.
   */
  | { kind: 'broken'; reason: string };

export type EmbeddingEngine = {
  /** Whether a call to `embed` could succeed right now. Opens nothing. */
  status: () => Promise<EngineStatus>;

  /**
   * Turns text into vectors, already normalised and quantised.
   *
   * Quantised here rather than by the caller because the two decisions belong
   * together: an engine that returned floats would make every caller remember
   * to normalise before storing, and the one that forgot would write vectors
   * that score wrong against every other vector in the database.
   *
   * `role` is not optional and not inferable. E5 is trained with a prefix on
   * every input and omitting it measurably degrades retrieval; using the wrong
   * one is worse than using none.
   */
  embed: (texts: readonly string[], role: 'passage' | 'query') => Promise<Quantised[]>;

  /**
   * Drops the session and its memory.
   *
   * Called when a job finishes and when the app goes to the background. The
   * model is over a hundred megabytes resident, which is not a thing to hold
   * while somebody reads.
   */
  release: () => Promise<void>;
};
