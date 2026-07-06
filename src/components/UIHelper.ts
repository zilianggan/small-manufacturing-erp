type CallApiOptions<T> = {
    onCompleted?: (data: T) => void;
    onError?: (error: Error) => void;
};

export async function CallAPI<T>(
    request: () => Promise<T>,
    options?: CallApiOptions<T>
): Promise<T | null> {
    try {
        const data = await request();

        options?.onCompleted?.(data);

        return data;
    } catch (err) {
        options?.onError?.(err as Error);

        return null;
    }
}