// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AuditAnchor
 * @notice Immutability anchor for SAFR Runtime audit records.
 *
 * Bible Section 8: "write a hash of each record to a testnet smart contract to
 * support the 'immutable' claim without needing a full custom chain."
 *
 * The chain stores only `keccak256(canonical_json(record))`. The record itself stays
 * in Postgres. That is the whole design: no audit content, no counterparty, no
 * amount, and no personal data is ever written on-chain — only a fixed-size digest
 * that proves a specific record existed in a specific form at a specific block.
 *
 * Tamper-evidence works by recomputation: hash the stored record again and compare
 * against the digest anchored here. Any edit to the record, however small, changes
 * the hash and the comparison fails.
 */
contract AuditAnchor {
    /**
     * @param recordHash keccak256 of the canonical JSON of the audit record.
     * @param submitter  The account that anchored it.
     * @param blockTime  Block timestamp, so verification needs only the event.
     */
    event Anchored(bytes32 indexed recordHash, address indexed submitter, uint256 blockTime);

    /// @notice Number of anchors written. Cheap sanity check after a demo run.
    uint256 public anchorCount;

    /**
     * @notice Anchor one audit record digest.
     * @dev Deliberately permissionless and non-deduplicating. Access control would
     *      add a failure mode to a demo-critical path for no benefit here: the digest
     *      is meaningless without the off-chain record, and a duplicate anchor is
     *      harmless. Anchoring the same record twice is valid.
     */
    function anchor(bytes32 recordHash) external {
        unchecked {
            anchorCount++;
        }
        emit Anchored(recordHash, msg.sender, block.timestamp);
    }
}
