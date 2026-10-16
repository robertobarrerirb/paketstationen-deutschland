// Type declarations for Redoc custom element

declare global {
  namespace JSX {
    interface IntrinsicElements {
      redoc: {
        'spec-url'?: string;
        theme?: string;
        'expand-responses'?: string;
        'required-props-first'?: string;
      };
    }
  }
}

export {};
