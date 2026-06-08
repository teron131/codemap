/** Defines supported signal section names and output limits. */
export const SIGNAL_SECTION_CHOICES = [
	"all",
	"top",
	"relationships",
	"files",
	"lengths",
	"functions",
	"variables",
	"usage",
] as const;

export type SignalSection = (typeof SIGNAL_SECTION_CHOICES)[number];

export const SIGNAL_OUTPUT_ROW_LIMIT = 1_000;
export const SIGNAL_TOP_ROW_LIMIT = 20;
