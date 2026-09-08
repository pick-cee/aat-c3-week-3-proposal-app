"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { processMaterial, requestUploadSlot } from "@/app/actions/materials";
import { Icon, cn } from "@/components/ui/primitives";
import {
	ACCEPTED_FILE_TYPES,
	SUPPORTED_FORMATS_LABEL,
} from "@/lib/materials/formats";

interface FileProgress {
	filename: string;
	state: "uploading" | "processing" | "done" | "error";
	message?: string;
}

export function MaterialUploader({ proposalId }: { proposalId: string }) {
	const router = useRouter();
	const inputRef = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState<FileProgress[]>([]);
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);

	async function handleFiles(fileList: FileList | null) {
		if (!fileList?.length) return;

		const files = Array.from(fileList);
		setBusy(true);
		setProgress(files.map((f) => ({ filename: f.name, state: "uploading" })));

		const update = (index: number, patch: Partial<FileProgress>) =>
			setProgress((prev) =>
				prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
			);

		// Sequential on purpose: each file's outcome is recorded before the next
		// starts, so a crash halfway leaves an accurate record rather than a set
		// of half-written rows.
		for (const [index, file] of files.entries()) {
			try {
				const slot = await requestUploadSlot(
					proposalId,
					file.name,
					file.type || null,
					file.size,
				);

				const response = await fetch(slot.signedUrl, {
					method: "PUT",
					body: file,
					headers: file.type ? { "content-type": file.type } : undefined,
				});

				if (!response.ok) {
					throw new Error(
						`Upload failed (${response.status}). The file may be too large.`,
					);
				}

				update(index, { state: "processing" });
				await processMaterial(slot.materialId);
				update(index, { state: "done" });
			} catch (error) {
				// One bad file never stops the batch.
				update(index, {
					state: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}

		setBusy(false);
		router.refresh();
	}

	return (
		<div>
			<div
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					void handleFiles(e.dataTransfer.files);
				}}
				onClick={() => inputRef.current?.click()}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						inputRef.current?.click();
					}
				}}
				className={cn(
					"flex cursor-pointer flex-col items-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
					dragging
						? "border-accent bg-accent/[0.03]"
						: "border-line-strong bg-surface/50 hover:border-line-strong hover:bg-surface",
					busy && "pointer-events-none opacity-60",
				)}
			>
				<Icon
					name="file"
					className={cn(
						"h-7 w-7 transition-colors",
						dragging ? "text-accent" : "text-ink-subtle",
					)}
				/>
				<p className="mt-2.5 text-sm font-medium text-ink">
					{dragging ? "Drop them here" : "Drop files, or click to browse"}
				</p>
				<p className="mt-1 max-w-sm text-xs text-ink-muted">
					{SUPPORTED_FORMATS_LABEL}. Upload as many as you like — every file is
					read, and anything we cannot read says why.
				</p>

				<input
					ref={inputRef}
					type="file"
					multiple
					accept={ACCEPTED_FILE_TYPES}
					disabled={busy}
					onChange={(e) => {
						void handleFiles(e.target.files);
						e.target.value = "";
					}}
					className="hidden"
				/>
			</div>

			{progress.length > 0 && (
				<ul className="mt-3 space-y-1.5">
					{progress.map((item, i) => (
						<li
							key={`${item.filename}-${i}`}
							className="flex items-center gap-2 rounded border border-line bg-surface px-3 py-2 text-sm animate-fade"
						>
							<ProgressIcon state={item.state} />
							<span className="min-w-0 flex-1 truncate text-ink">
								{item.filename}
							</span>
							<span className="shrink-0 text-xs text-ink-subtle">
								{
									{
										uploading: "uploading…",
										processing: "reading…",
										done: "done",
										error: "failed",
									}[item.state]
								}
							</span>
							{item.message && (
								<span className="w-full text-xs text-state-failed">
									{item.message}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ProgressIcon({ state }: { state: FileProgress["state"] }) {
	if (state === "done") {
		return (
			<Icon name="check" className="h-4 w-4 shrink-0 text-state-approved" />
		);
	}
	if (state === "error") {
		return <Icon name="alert" className="h-4 w-4 shrink-0 text-state-failed" />;
	}
	return (
		<span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
	);
}
