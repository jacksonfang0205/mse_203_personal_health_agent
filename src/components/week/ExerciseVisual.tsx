import Image from "next/image";
import { getExercise } from "@/lib/catalog";
import { exercisePhotos } from "@/lib/exercisePhotos";
import { CATEGORY_STYLE } from "@/lib/labels";
import { CategoryIcon } from "../icons";
import { cx } from "../ui";

/**
 * A picture of the movement: the start and end photos crossfade so the motion
 * reads at a glance. Exercises without a photo get an illustrated card.
 */
export function ExerciseVisual({ exerciseId, className, sizes = "160px" }: { exerciseId: string; className?: string; sizes?: string }) {
  const ex = getExercise(exerciseId);
  const photos = exercisePhotos(exerciseId);
  const style = ex ? CATEGORY_STYLE[ex.category] : CATEGORY_STYLE.mobility;

  if (!photos) {
    return (
      <div className={cx("relative grid aspect-[3/2] place-items-center overflow-hidden rounded-xl", style.soft, className)}>
        <div aria-hidden className="absolute -right-4 -bottom-6 h-20 w-20 rounded-full bg-card/50" />
        <CategoryIcon category={ex?.category ?? "mobility"} width={34} height={34} className={style.text} />
      </div>
    );
  }
  return (
    <div className={cx("relative aspect-[3/2] overflow-hidden rounded-xl bg-white", className)}>
      <Image src={photos[0]} alt={`${ex?.name ?? exerciseId}, start position`} fill sizes={sizes} className="object-cover" />
      <Image
        src={photos[1]}
        alt=""
        aria-hidden
        fill
        sizes={sizes}
        className="animate-pose object-cover opacity-0"
      />
    </div>
  );
}
