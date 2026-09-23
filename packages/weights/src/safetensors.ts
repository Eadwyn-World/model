/**
 * A strict safetensors codec for float32 tensors.
 *
 * Format: 8-byte little-endian header length N, N bytes of JSON header
 * ({ name: { dtype, shape, data_offsets: [start, end] }, __metadata__ }),
 * then the raw tensor bytes. Decoding validates everything a hostile
 * uploader could get wrong: header size, dtypes, shapes, offsets, overlaps
 * and holes. Only F32 is supported for now; adapters are trained in F32.
 */
export interface Tensor {
  dtype: "F32";
  shape: number[];
  data: Float32Array;
}

export type TensorMap = Record<string, Tensor>;

export class SafetensorsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetensorsError";
  }
}

const MAX_HEADER_BYTES = 16 * 1024 * 1024;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function elementCount(shape: number[]): number {
  return shape.reduce((n, d) => n * d, 1);
}

export function encodeSafetensors(
  tensors: TensorMap,
  metadata: Record<string, string> = {},
): Uint8Array {
  const names = Object.keys(tensors).sort();
  const header: Record<string, unknown> = {};
  if (Object.keys(metadata).length > 0) {
    header.__metadata__ = metadata;
  }
  let offset = 0;
  for (const name of names) {
    const tensor = tensors[name] as Tensor;
    if (tensor.data.length !== elementCount(tensor.shape)) {
      throw new SafetensorsError(
        `${name}: ${tensor.data.length} values do not fit shape [${tensor.shape}]`,
      );
    }
    const bytes = tensor.data.length * 4;
    header[name] = { dtype: "F32", shape: tensor.shape, data_offsets: [offset, offset + bytes] };
    offset += bytes;
  }
  let json = JSON.stringify(header);
  // Pad with spaces so the data section starts on an 8-byte boundary.
  while ((8 + new TextEncoder().encode(json).byteLength) % 8 !== 0) {
    json += " ";
  }
  const headerBytes = new TextEncoder().encode(json);
  const out = new Uint8Array(8 + headerBytes.byteLength + offset);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, BigInt(headerBytes.byteLength), true);
  out.set(headerBytes, 8);
  let cursor = 8 + headerBytes.byteLength;
  for (const name of names) {
    const { data } = tensors[name] as Tensor;
    if (LITTLE_ENDIAN) {
      out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), cursor);
    } else {
      for (let i = 0; i < data.length; i += 1)
        view.setFloat32(cursor + i * 4, data[i] as number, true);
    }
    cursor += data.byteLength;
  }
  return out;
}

export function decodeSafetensors(bytes: Uint8Array): {
  tensors: TensorMap;
  metadata: Record<string, string>;
} {
  if (bytes.byteLength < 8) {
    throw new SafetensorsError("file is shorter than its length prefix");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = Number(view.getBigUint64(0, true));
  if (headerLength > MAX_HEADER_BYTES || 8 + headerLength > bytes.byteLength) {
    throw new SafetensorsError(
      `header length ${headerLength} is invalid for a ${bytes.byteLength}-byte file`,
    );
  }
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        bytes.subarray(8, 8 + headerLength),
      ),
    );
  } catch {
    throw new SafetensorsError("header is not valid UTF-8 JSON");
  }
  if (header === null || typeof header !== "object" || Array.isArray(header)) {
    throw new SafetensorsError("header must be a JSON object");
  }
  const dataStart = 8 + headerLength;
  const dataLength = bytes.byteLength - dataStart;
  const metadata: Record<string, string> = {};
  const spans: [number, number, string][] = [];
  const tensors: TensorMap = {};

  for (const [name, entry] of Object.entries(header)) {
    if (name === "__metadata__") {
      for (const [k, v] of Object.entries((entry ?? {}) as Record<string, unknown>)) {
        if (typeof v !== "string") throw new SafetensorsError(`metadata ${k} must be a string`);
        metadata[k] = v;
      }
      continue;
    }
    const info = entry as { dtype?: unknown; shape?: unknown; data_offsets?: unknown };
    if (info?.dtype !== "F32") {
      throw new SafetensorsError(
        `${name}: dtype ${String(info?.dtype)} is not supported (F32 only)`,
      );
    }
    const shape = info.shape;
    if (!Array.isArray(shape) || !shape.every((d) => Number.isInteger(d) && d >= 0)) {
      throw new SafetensorsError(`${name}: invalid shape`);
    }
    const offsets = info.data_offsets;
    if (
      !Array.isArray(offsets) ||
      offsets.length !== 2 ||
      !offsets.every((o) => Number.isInteger(o) && o >= 0) ||
      (offsets[0] as number) > (offsets[1] as number) ||
      (offsets[1] as number) > dataLength
    ) {
      throw new SafetensorsError(`${name}: invalid data_offsets`);
    }
    const [start, end] = offsets as [number, number];
    const count = elementCount(shape as number[]);
    if (end - start !== count * 4) {
      throw new SafetensorsError(`${name}: ${end - start} bytes do not match shape [${shape}]`);
    }
    spans.push([start, end, name]);
    const slice = bytes.slice(dataStart + start, dataStart + end);
    let data: Float32Array;
    if (LITTLE_ENDIAN) {
      data = new Float32Array(slice.buffer, slice.byteOffset, count);
    } else {
      const dv = new DataView(slice.buffer);
      data = new Float32Array(count);
      for (let i = 0; i < count; i += 1) data[i] = dv.getFloat32(i * 4, true);
    }
    tensors[name] = { dtype: "F32", shape: shape as number[], data };
  }

  spans.sort((a, b) => a[0] - b[0]);
  let expected = 0;
  for (const [start, end, name] of spans) {
    if (start !== expected) {
      throw new SafetensorsError(`${name}: data section has a hole or an overlap at byte ${start}`);
    }
    expected = end;
  }
  if (expected !== dataLength) {
    throw new SafetensorsError(
      `data section has ${dataLength - expected} unindexed trailing bytes`,
    );
  }
  return { tensors, metadata };
}
