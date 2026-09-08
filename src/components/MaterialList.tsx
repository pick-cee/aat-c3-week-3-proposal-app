"use client";

import { useTransition } from "react";

import { deleteMaterial } from "@/app/actions/materials";
import { Icon, cn } from "@/components/ui/primitives";
import type { ExtractionStatus, SupportingMaterial } from "@/lib/db/types";

const STATUS: Record<
	ExtractionStatus,
	{ label: string; chip: string; icon: Parameters<typeof Icon>[0]["name"] }
> = {
	pending: {
		label: "Uploading",
		chip: "bg-surface-sunken text-ink-subtle",
		icon: "clock",
	},
	ok: {
		label: "Read",
		chip: "bg-state-approved-fill text-[hsl(163_88%_20%)]",
		icon: "check",
	},
	empty: {
		label: "Nothing in it",
		chip: "bg-state-review-fill text-[hsl(32_81%_29%)]",
		icon: "alert",
	},
	unsupported: {
		label: "Unsupported format",
		chip: "bg-state-review-fill text-[hsl(32_81%_29%)]",
		icon: "alert",
	},
	failed: {
		label: "Could not be read",
		chip: "bg-state-failed-fill text-[hsl(0_74%_35%)]",
		icon: "alert",
	},
};

export function MaterialList({
	materials,
	editable,
}: {
	materials: SupportingMaterial[];
	editable: boolean;
}) {
	if (materials.length === 0) {
		return (
			<p className="text-sm text-ink-subtle">
				No supporting materials uploaded.
			</p>
		);
	}

	return (
		<ul className="stagger space-y-2">
			{materials.map((material) => (
				<MaterialRow
					key={material.id}
					material={material}
					editable={editable}
				/>
			))}
		</ul>
	);
}

function MaterialRow({
	material,
	editable,
}: {
	material: SupportingMaterial;
	editable: boolean;
}) {
	const [pending, startTransition] = useTransition();
	const status = STATUS[material.extraction_status];

	return (
		<li className={cn("card p-3.5", pending && "opacity-50")}>
			<div className="flex items-start gap-3">
				<span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-sunken text-ink-subtle">
					<Icon name="file" className="h-3.5 w-3.5" />
				</span>

				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<p className="truncate text-sm font-medium text-ink">
							{material.filename}
						</p>
						<span
							className={cn(
								"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium",
								status.chip,
							)}
						>
							<Icon name={status.icon} className="h-3 w-3" />
							{status.label}
						</span>
					</div>

					<p className="mt-0.5 text-2xs text-ink-subtle">
						{material.size_bytes
							? `${(material.size_bytes / 1024).toFixed(0)} KB`
							: "unknown size"}
						{/* `ok` does not imply "has a summary" — a file can be read
                successfully and still be over the summarization cap. */}
						{material.extraction_status === "ok" && (
							<>
								<span className="mx-1">·</span>
								{material.summarized ? (
									<span className="text-state-approved">
										summarized for generation
									</span>
								) : (
									<span className="text-state-review">not summarized</span>
								)}
							</>
						)}
					</p>

					{material.extraction_note && (
						<p className="mt-2 rounded bg-surface-sunken px-2.5 py-1.5 text-xs leading-relaxed text-ink-muted">
							{material.extraction_note}
						</p>
					)}
				</div>

				{editable && (
					<button
						type="button"
						disabled={pending}
						onClick={() =>
							startTransition(async () => {
								await deleteMaterial(material.id);
							})
						}
						className="shrink-0 rounded p-1 text-ink-subtle transition-colors hover:bg-state-failed-fill hover:text-state-failed"
						aria-label={`Remove ${material.filename}`}
					>
						{/* Decorative: the button already has an aria-label naming the file. */}
						<svg
							viewBox="0 0 24 24"
							className="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M18 6 6 18M6 6l12 12" />
						</svg>
					</button>
				)}
			</div>
		</li>
	);
}
