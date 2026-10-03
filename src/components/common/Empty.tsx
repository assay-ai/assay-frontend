import Image from "next/image";

export const Empty = ({
  image = "/images/empty.svg",
  size = 128,
  text = "No item found",
  className = "",
}: {
  image?: string;
  size?: number;
  text?: string;
  className?: string;
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center h-full gap-4 ${className}`}
    >
      <Image src={image} alt="empty" width={size} height={size} />

      <span className="text-sm text-03">{text}</span>
    </div>
  );
};
