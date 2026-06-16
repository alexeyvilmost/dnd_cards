import random
from typing import Tuple, List


def roll_dice(dice_str: str) -> Tuple[int, List[int]]:
    """Parse and roll '2d6', '1d8', '1d4+1'. Returns (total, individual_rolls).

    The flat modifier (e.g. the +1 in '1d4+1') is folded into the total but
    not into the per-die rolls list.
    """
    dice_str = dice_str.lower().strip().replace(" ", "")
    flat = 0
    if "+" in dice_str:
        dice_str, mod = dice_str.split("+", 1)
        flat = int(mod)
    elif "-" in dice_str[1:]:  # allow leading sign on count, but here means subtraction
        dice_str, mod = dice_str.split("-", 1)
        flat = -int(mod)
    if "d" not in dice_str:
        val = int(dice_str) + flat
        return val, [int(dice_str)]
    parts = dice_str.split("d")
    count = int(parts[0]) if parts[0] else 1
    sides = int(parts[1])
    rolls = [random.randint(1, sides) for _ in range(count)]
    return sum(rolls) + flat, rolls


def d20() -> int:
    return random.randint(1, 20)


def ability_modifier(score: int) -> int:
    return (score - 10) // 2
