import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  description?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  cancel?: {
    label: string;
    onClick: () => void;
  };
  duration?: number;
  position?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  style?: React.CSSProperties;
  [key: string]: any;
}

const defaultCancelButton = {
  label: "✕",
  onClick: () => {
    sonnerToast.dismiss();
  },
};

const defaultDuration = 3000; // 3 seconds

const customToast = (message: string, options?: ToastOptions) => {
  return sonnerToast(message, {
    duration: defaultDuration,
    ...options,
    cancel: options?.cancel || defaultCancelButton,
    className: "toast-with-progress",
  });
};

export const toast = Object.assign(customToast, {
  success: (message: string, options?: ToastOptions) => {
    return sonnerToast.success(message, {
      duration: defaultDuration,
      ...options,
      cancel: options?.cancel || defaultCancelButton,
      className: "toast-with-progress toast-success",
    });
  },

  error: (message: string, options?: ToastOptions) => {
    return sonnerToast.error(message, {
      duration: defaultDuration,
      ...options,
      cancel: options?.cancel || defaultCancelButton,
      className: "toast-with-progress toast-error",
    });
  },

  warning: (message: string, options?: ToastOptions) => {
    return sonnerToast.warning(message, {
      duration: defaultDuration,
      ...options,
      cancel: options?.cancel || defaultCancelButton,
      className: "toast-with-progress toast-warning",
    });
  },

  info: (message: string, options?: ToastOptions) => {
    return sonnerToast.info(message, {
      duration: defaultDuration,
      ...options,
      cancel: options?.cancel || defaultCancelButton,
      className: "toast-with-progress toast-info",
    });
  },

  loading: (message: string, options?: ToastOptions) => {
    return sonnerToast.loading(message, {
      duration: defaultDuration,
      ...options,
      cancel: options?.cancel || defaultCancelButton,
      className: "toast-with-progress toast-loading",
    });
  },

  promise: <T>(
    promise: Promise<T>,
    options: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: Error) => string);
      cancel?: {
        label: string;
        onClick: () => void;
      };
      duration?: number;
      [key: string]: any;
    }
  ) => {
    const { loading, success, error, duration, ...restOptions } = options;

    return sonnerToast.promise(promise, {
      loading,
      success: (data: T) => {
        const message = typeof success === "function" ? success(data) : success;
        return message;
      },
      error: (errorData: Error) => {
        const message = typeof error === "function" ? error(errorData) : error;
        return message;
      },
      duration: duration || defaultDuration,
      ...restOptions,
      cancel: restOptions?.cancel || defaultCancelButton,
    });
  },

  custom: (
    jsx: (id: string | number) => React.ReactElement,
    options?: ToastOptions
  ) => {
    return sonnerToast.custom(jsx, {
      duration: defaultDuration,
      ...options,
    });
  },

  dismiss: (id?: string | number) => {
    return sonnerToast.dismiss(id);
  },
});

export const {
  success,
  error,
  warning,
  info,
  loading,
  promise,
  custom,
  dismiss,
} = toast;
