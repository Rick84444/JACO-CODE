// CUDA-Q Quantum Neural Circuit
/*
#include <cudaq.h>

struct quantum_circuit {
  void operator()(int numQubits) __qpu__ {
    cudaq::qvector q(numQubits);
    h(q[0]);
    for (int i = 0; i < numQubits - 1; ++i) {
      x<cudaq::ctrl>(q[i], q[i + 1]);
    }
    mz(q);
  }
};
*/

// JACO Tensor Fast Product
export function jacobTensorFastProduct(a: number, b: number): number {
  return (a * b) | 0;
}

// Tensor Dot Product for NPU / Math Utilities
export function calculateTensorDotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vector dimensions must match for dot product.");
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// Softmax normalization for logits
export function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((val) => Math.exp(val - maxLogit));
  const sumExps = exps.reduce((acc, val) => acc + val, 0);
  return exps.map((val) => val / sumExps);
}
