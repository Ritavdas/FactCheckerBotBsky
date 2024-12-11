export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cleanText(text: string): string {
	return text
		.replace(/\*\*\*/g, "")
		.replace(/\*\*/g, "")
		.replace(/\[[\d,\s]+\]/g, "") // Remove citation references like [1], [2]
		.replace(/Source:.*$/, ""); // Remove any source text at the end
}
