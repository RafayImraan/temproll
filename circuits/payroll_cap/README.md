# Payroll cap proof

## Statement and privacy boundary

The prover knows a private `salary: u64` and proves both `salary <= cap` and that `commitment` is Poseidon(domain, salary). The public inputs are only `cap` and `commitment`. Neither the private salary nor a recipient/address is part of the proof statement. Domain separation prevents accidental reuse as a generic commitment. Do not expose the commitment as an identity or salary identifier; it is deterministic and equality-linkable.

The proof does not itself authorize a payment, conceal an on-chain transfer, prove employment, or protect the salary witness if the prover leaks it. The cap is public. The commitment uses BN254 Poseidon; soundness relies on the correctness of the Noir compiler, Barretenberg proving/verifying stack, and the security of the underlying field hash. This is an experimental compliance demonstration, not an audited payroll credential system.

## Build and prove

Install Noir 1.0+ (`noirup`) and a compatible Barretenberg backend (`bb`). The Poseidon package version is pinned to `v0.1.1`. Pin the Nargo and BB binaries in real deployments and record `nargo --version` and `bb --version`.

```powershell
nargo check
nargo compile
nargo test
```

For reproducible local proving, create `Prover.toml` (ignored by git) with private `salary` and public `cap` and `commitment`. Generate the commitment with the same pinned `poseidon` `hash_2([domain, salary])` implementation; the included Noir unit test demonstrates matching the in-circuit relation. Do not store an actual payroll witness in a committed file. Then:

```powershell
nargo execute
bb write_vk -b target/payroll_cap.json -o target --oracle_hash keccak
bb prove -b target/payroll_cap.json -w target/payroll_cap.gz -o target --oracle_hash keccak
bb verify -k target/vk -p target/proof -i target/public_inputs --oracle_hash keccak
bb write_solidity_verifier -k target/vk -o target/HonkVerifier.sol
```

Exact artifact flags vary between Barretenberg releases. Pin the tool version and use its `bb prove --help` / `bb verify --help`; verification must exit successfully against the generated proof and fail for altered public inputs. Generate the verification key and Solidity verifier with the matching `bb write_vk` and `bb write_solidity_verifier` commands, then review its input encoding before connecting it to a contract. No verifier source is checked in because a handwritten verifier would be unsafe and a generated verifier requires pinned tool artifacts.

Negative cases: a salary above cap must fail circuit execution; a proof verified with a modified commitment or cap must fail. A Solidity integration is unverified until a generated verifier contract and end-to-end tests are present.
