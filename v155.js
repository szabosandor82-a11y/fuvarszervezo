/* ===== FUVARSZERVEZŐ V155 =================================================
   1. „E-mail” gomb a függő rendeléseknél: kész Outlook-levélpiszkozat
      (.eml, X-Unsent) nyílik „Hátralék információ” tárggyal, a sablon
      szöveggel, az aláírással és a rendelés PDF-jével. A címzett üres.
      Telefonon (ahol a böngésző fájlt is meg tud osztani) a megosztó menü
      nyílik a PDF-fel, a tárggyal és a szöveggel.
   2. „Korábban teljesült: dátum · sofőr” felirat azon a fuvaron, amelynek
      rendelése egy korábbi fuvarban már teljesült (az újonnan felvett
      példányt a korábbi teljesítés nem pipálja ki – SUPABASE_V155.sql). */
(function (global) {
  'use strict';
  const st = () => (typeof state !== 'undefined' ? state : (global.state || {}));
  const SUBJECT = 'Hátralék információ';
  const TEXT_LINES = ['Szia!', '', 'A melléklet rendelés hátraléka után szeretnék érdeklődni, hogy esetleg beérkezett e már, vagy van e valami információ?', '', 'Várom a válaszod!', 'Köszi!'];
  const LOGO_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAI4AAABsCAIAAAAzEx3WAAAjT0lEQVR42u19aXhV1dn2vfbeZ55PhhMyz4QAGQizgIKCZXTAy4qKQ7W20uplwbcfVfpWwVp9/Syo1aI4flX0ugRb8C0iWIQIISRhCAaSkJBABkLmk+QM+5w9rO/HDjEkIZyYMEmeX1xhn3XWWc9ez7qf+xkWoZRiWK4FYYaXYFhVwzKsqmFVDcuwqoZlaIQbqoEopZRSQgghZAjHFEVxQBiVYRiOZSGLkCUEPhNKwTBgOBDmp6+qurq6goKC5OTklJSUoRrz9OnTb731VlNTk6K2/h9WXpGIyJjHHrwrqm0L6g+DMmAI+v8gIaAURIYhGikPI2TMj56tJEmEEIZhrnZVud3uzz77zOfzPfvss+PGjRuSMVtbW7dv324ymWJjY2VZ7l9PVJYrKiuPl568bc7kqPbv0FAMexYIBZX7VzEYDu2laDyByLk/WlU8z3/88cdJSUkzZswYQrsyfFZd32eVWq02Go2HDh1asWLFsmXLFi5cqNVqBzkmIUStVj/22GP3338/y7L9P+zxeP7+9/WffPY5wxAwWsTchpmvBfpNea+h6P8B8o+eqtfrXbdu3R133HHDDTdwHHdV7ypRFCVJSkxMDA8PX7169csvv1xXVzckyCLAX04IYRhCCGEZBqAY0JnBMgCFTAfzVhmNRrVafQ2AdQWtpaen//Wvf/35z3/+6aefrly5srCwcPAjS5IU+AQ6D3aCix1RPT4sDX6eQ4t+L6GqCCGUUpfLZbPZVq5c+cILL5w8eXLFihVffvmlz+cbPmmuRlghSRLHcXfdddfatWuDgoKee+65t956q6GhYXitr14EOGHChFdeeWXWrFlvv/32qlWrCgsLAzRlw3IFwHp0dPTzzz+/fPnygoKC3//+919//TXP88OLfpX6VXq9/rHHHnvttddMJtNzzz339ttvnz17dnjdh13gYRd40DJ9+vTIyMjXX3/9vffeq6ys/OUvf5mSknJRr3ZYroCqAMTFxT3//PMpKSnvv/9+dXX1smXLpk+ffkl9xmED2K8rCdI5pixB7on3zGbzr371qzVr1giCsGrVqo8++qixsXE4D+dK7CrCEMISmUdTEVqrEJoJS2zvp+bMmRMVFfW3v/3t9ddfd7lcjz76qMlkuh7XntLOd5tSUIAw/QfYhk5VhJWhkp3ltHAd6r+GpMHkP/epKgCjRo1avXr1gw8+mJeXd/fdd19/qqLwd8BZBmcZ/DyoDLUe1iRYk6AxAeSSqYrKEFrQcIA6T0EsJ6fPgPFAHQGmv8GDgoIsFgvHcZeUN7saReRRuw8ln8J5Eu4qmGKhD0VjHjgrHOMwcglGTIZKP6SqkkW0VwNA3QE07CClh5h2J42bwk57HPXZOJ0N0h9hKoqiKIoqler60hPvRPEHKPkUcXcg8U4c/wTJi2nkZOx5mthGgqixfxUSF2PMo9BYhkJVsoiWMtTtRfU2AGgsQWgsImYj6Jg+bJQqagbavgcVMER4IfAQ+KULlg/RfvLh+Eco/wQT/4SEhTjxBbR6REwihnCEjAPfiom/gyMdef8NwiHt1+A0wy7w9YAAJT8aDqN2N2p3w1UDSzwApD+OxEWkiYXxOZHvEARRJXkVQDhYpEIIISRAI0kIYTnuKl5qivoCVGzF5D8j+lbwLbSxkFiSYYwAgJBMevht0lyKuHlgOOS/jNAsRN7QHWIE/Nv8Hag/iNM7cCYbQjvCxmHkUoyYBgCWaABy/UnIAgWoLEP0gTBgB+veyrLM8/yOHTt8Pt9F02AkScrPy1Ndtdrye+jRd4jKDGMi6o/QtlO0sRRhmaTpGGQRvnZCCZpLwGlgSgBnxvcbEJoJtWGAqhK9KP0UZR/C58OIKYi6FeFToAvuy1EAoCQJkcFbV51Ol5CQUFZWVlVV1b+nrAR/6+vrLfZQluUuhHev5J5yVpC24zCPwaG3QSjcZ0jDUUIYeFpAJQgeuCtR+jnqj4BwUNvQVoT2CgSPHaiqeJz5Dr4O3PA6HFnQmC9qjDp1NjiJiop69tlnvV6vEonvX1WCIGzZsuVYcZlBq+1NlFxpRUloOgJTFKasAmHAcOTsITAajF0KexKoBF8HLfgzMSdh5BKoDRD9yPk96g8jKBWEHZABpKAEunhEz7ycP9BgMEycODHAh91u9+HDh4tLTxoNelxtMUxKic8D01jYEs5NtwFGB+xJMEV2vm3GZGhDYYnpdKrMY+H3gNIuA8EEqiqI4NSBPqsMTy43uef1ei9pfutgRfaeb3jIeYaaimCYH7AY9fUw4wEfwrIENrAlIOcOrStEw1JQgOnhlFxszhpQcgkPOMLAYEPlIdQVgGHBqNBUDGcl6vLBtwIyfO1wFgEiGo+C1UAW0VyAsIzuKDpgVRESSLoWIYQQCtkPwoLTXildQfKh5Tgqt0HyXeSVIQScFk35gHAJ3y3CIGQcvC7kvACdA7IITzOaj8PfAWM4qATJh+YquN1obwCjhr8RvAuhWT9KVQOxy5AlMAwY9spsKcJBZUTjYRxYDdCLqwoEvmYYHVDrL+HMzFGInIH6o5i0HH4XXLUo3YygkUhYAElESxl8boy8HY50sDrs/h0ipsMUNcxW/LTZCkIGlidMKa5EzFCWBElrwozn4T47gOOHUqjMMI28hDNjNUi9H21/QlsZ4heAj0fTIbAMQtMAwHsWWgMc6XBkoHIbVGqMur/HCcINYOnJNbAFOQY+gX6T31p+slaS5ADfFpZlHKG+KZNiR4RdyskFj8boh1HwMvwdSFmC0Cyc2oKO0zDFoPU4IsYjaCRObEbha8hYjuDRP2pXURmyH5xxAFvwSqmKU3nc7o8+fP/IkUKtRhPYS0j9fn9UVKQj2D4izHEJJ0dYxP4Msoij69FwCNZRaGvEyZ0IHoW6AgSNwb5VaDqG9KcQN7d3tI8LdEvJ0jWxqwCIouhubxs/LuOJJ56QZbl/8pBhGJVKtXHjxuzsbJ73XvLJsWok3gZ7Ksr/idLP4KyAtwIsiw4nXI2IvwUz18Ga1CciG2IESCkgyxD9YFiwVyxsqFKrIyIiAi+ezM/Pz8nJuUyTIyzsI5H1O6Tci9ZieOsBCl0Y7KnQh4LVXMgmXQqwLkMWARbkipHclFJBEAJ/3u/3X9b5Kc6cJQbm6HP1d8xFTw3uki7YMMIO4FAP1PvkAh2RkKFdekIICKEguN7SYHo7GLKs1MgQQliWvVAMYdgF/om5wJII0Qf9UPIuLMtyDMewKkKu69fF7Xbn5OQUFRX5/f74+Phbb73VbDYPQlVUhiQEGICngMKun8cUNBTi1Ba4z0ACoIJGLYtUaC5VqVla8DzsFghMNwNLwanBnO8VEQYqAxgOnBZxc2CK+AnoqaWlZcOGDRs3bvR6vSzLjhkzZsKECYNTVcBnFSEEsgjJD7Bd4UsAaClH+WaIIlQh8HvA+GUJ1OehEiG1uWgW4Pd3G58AtGdrAgZgWEg8tGqYIn8aqtq5c+fHH3/M87zBYLBarcnJyTqd7jIhQAoQIgECwJ03uCTALWHicoy+H6IbDIhfIv/7a2i19Gf/jTA7fPx5+EISIftAu29MCbKEqv+gaN0VC4UNqXR0dBQXF/M8TyldsmTJ0qVLTSaTwWC4jGBdCTuQHjFMPxgG+hBwGiXox6jAqNREpYHaDE0IAuGAKEV7FRj2QqpSsNO1UlrS0NBQV1enoL7Y2FiHw9G/L8gFuvqdRmkQfjE5z9OSJJHKMqg8AB+AEMi+CxHHSuu0LoVd5dTXoUOHNm/eXFpaqlBfmzdvLioqSkpKWrRokdVqHQRYpxJkYfB5fUPxK3kQAk7fp3fidrsZhtFoNP3zfleDqg4cOLB169aamhpFVYcOHdq0aVNBQUE/vEmAQFmG5AerCfTdv0LvtSzL10RdCcuyUVFR0dHRRqNRMQNhYWFxcXE33nijzWYbpKqG5VpxgRUAHeChQmVQCSDn47dh6bboHDdz5ky73b5hw4b9+/cTQhYuXDh//vzw8PB+en8NNQKkoKIfgg+sGix3nqa7/OPrXgghFotl1KhRwcHBStZibGzsmDEX6Rp5yQwgPT8WTEWwXKBJn9eHiKLYBSK83otHNQeiqsH4K7IAMhQRLKXCmbkeTWvgqpL7r+0N0DsbrEg8gCuWDHoNqEqWIPB91hJffjwOivPYxZ/K6TVEqmJYsOSiOesMwzAsy7IMGIAj53EKDNPDajFK99KBdqbkWDAXNIDKEa1E5wZUZNA1mcvsBYqiqMzW4/FclA/jLjSK2+1WGocTwlKXG5IEUdD6/H2m9ahUKuV5WZLcfg8RfaBayouU7wBkvd7g8fkBAq9Hw/t8Pl5ZSkmSZFl2uVxut1sUxYCca58flIL3oa29u0VlGMblclFKZVn2+/1KXFUQBLfbfdFRDQaDcrx7vV6fz9e9DR4hxGAwXKJeUBaLZd68edHR0VqtdsKECUMKK4blyhrJPved0+l855136urqWJYFy1Jvq1S1i1jj2NDxhPZx8wPHcR0dHfn5+Tq9MSt9JNd0kEJNwyaDYUElwqjk1mKpuYx1ZLDmaFkSGIahlO7evZvjuIkTJ2q12kAacDKsWmwoQstRJvpmoguhsth9V8mynJ+f39raesMNN+Tm5hoMhnHjxnVxuP0cEgzDHD9+vKamJisrKzo6ugtAy7JsMBgeeuihhISEi87N6XTOnTt3/vz5K1euDLx5tyiKChmmHB0/xgAKglBVVVVZWalUt8tg/JjEOQXOefxCZbYMw8THx4PSk6frBSQAUJWXnzP+VKRqEemqOp6t+2GEpKQkWZarq6sDZ1dFaAQyTVPtZNDce9FHjBgRHh5eX18fGxsrimJJSUmAw6rV6pSUFLfbffz48e6LYLFYAvF4BkNbDJZYCgoKevnllwVBYJhzJzi5iHNFKVX2CqWUZRkqU5lSwhBCf/CGu39WuetloE4VYRhCQGVKe8Vkui6PUbjqgUatlM92ByNKi/d+wrJXBQfIMEw/4chhGTT4Ey9YV8gwFyIKuOF1u9ziPoNTX8F5CrQXpiMyrLGInQtD+LCqrrS0nEDuH+Ashyqy0++kXecLAWFRux2nt2HyX2BPHlbVlZP2auz7AyQet36KoNS+aDM/Go4gfw32P4Ppa2GOCkhVPM83NTW5XC5RFBmGUS7SMZvNer1ekqTGxkaXy9UdX3ZPQZFlWavVBgcHa7pVODU2Nra3t4eEhPSZ59bS0tLW1hYSEmIwGHrDDVmWa2trGYYJDw9XbrSor6/3eDxdT1JKVSqV0Wi0WCx98hSUUo/H09zczPM8wzBWq1VJYeiNwVwuV319vdvtppRqtdrQ0NALjTng8+nUdjhLMO/zH/Tkb4evGbIMbRA0VhxYDUaNrD9i969QuQ1jfwFG1Z+qZFkuKyvbvn17UVFRTU2Nsvp6vd7hcIwaNeq2226zWCwffPBBfn5+V6MqlUql0Wj8fr/ilAiCkJyc/NBDD3XdENfa2rpx48acnJwFCxbcfvvtvdtq7tixY8eOHRMnTly6dGlvRNPR0fHqq69qtdo1a9aoVCpZljds2FBeXq4QE4ryNBpNRETEqFGjpk2bFh8f3+O1O3jw4O7du0tLS1taWrRabVRU1LRp0wDMmjWre4y8qKho27Zt+fn5zc3NkiRZLJYxY8YsWLBg/Pjxg+2ITCU4K6CL69QTldH0PU58irZyUBmmBCTcBW0QRC/C0qGNQWtFD+gxzFZcM8L1NhQlJSVr1qwpKCiIj48PDw9XKDKXy1VRUVFcXBwVFTV79myGYbo72HV1dVVVVTabLTExEYAkSQoB2jXs0aNHt23bVl1dzfN8ZmZm74hnaWlpXl5efn5+TEzM7Nmze9glnuezs7MNBoMkScquysnJqaioSE1NVf7IsqzH49m7d+8XX3wxadKkhx56aNasWcpnfT7f9u3b165d29zcnJSUFBISwvN8Tk7O7t27AVRVVf3iF7+wWCzKHF599dV9+/YlJCQkJycrZnbLli15eXlr1qyZPHny4PhcAkb9w95oKMSB1ZA9GHEjWB3OZCNvNZ2wikRO6fRAWXUPx7Gnqvx+/4YNGwoLC++44477778/Pj6eZVlZlr1e75kzZ06fPp2QkGA0Gh9//PEHH3xQMYAcx23duvVPf/rT/PnzV6xY4ff7lU6nSjqOIgcOHHC5XOHh4ZWVlUePHk1NTe1h/Q0GA8MwPM+/+eabycnJPbgc5SIvk8nU9Sm9Xq/RaF588cXw8HBBEAghPM9XVFTs3Llzy5Ytr7zyitVqVaoWS0tL169f7/f7n3rqqTlz5tjtdo/Hk5eX99577wH4xz/+ER0dvXjxYgBff/313r17Z8+e/fjjjycmJjIMc/bs2fXr12/evHnbtm0jR4602+2D3hsUAHgnSj6G6MJNb3YiPdfP8c1vcPxD2BOhD+kzttdTVfX19d99992IESOefvrp0NDQ7ksZHByclpam7Dyz2dwdHdjtdpZlTSZTd/V0SWVlZX5+fnp6+qxZs959992cnJyZM2eOGDGiBxum0+lSU1MLCws/+OCDlStX9jlUDyohLCxM2RCKREREZGZmWq3Wt99++8MPP8zIyKCUHj169OTJk0uXLn300UeVx4xG44IFCxQ265lnnsnOzp4zZ45KpaqoqOA47vbbbx87trO1W0xMzH333ZeXl1dcXOxyuYZAVYoKfC1or0TkzT8gcmM4IqeTuu/gd0IfcnFmnVLa1tbmdrtHjBjRXU+9OZjecFExNX0+f/DgwRMnTmRkZMyfPz8+Pn7//v0VFRW9sYwsy4888sjkyZP/9a9/7dy586JhESVS0+OPRqPx7rvvjo+PLywsLC0tFQShtrbWZDIpL1l3GT169OjRo9PS0mpqapSEZEmSNBqN5vy6fJvNdmlyQHvVKyr5kxcuYWJ62xmdTtfQ0OB0OgdEoOECoUyv17t//369Xp+amqrT6TIzM91ud0FBgcfj6TGCx+OJjIxcsWKFzWZ74403ysvLA7wLuIeYzeYpU6a0t7eXlZUphlGtVvf2EBS8Hhwc7HQ629raNBpNVFSUy+UqLCzsHrIqKChobGxMTEwcGqZNma/WDnMsPbMHbafPURhncWYfODNUxkBhRWhoaHp6em5u7rp16xYuXGg0GhWMYDKZQkJCfgRg/f777wsLCzMzM5XjZ8qUKXFxcdnZ2QsWLOgdXOjo6Jg4ceKSJUvefPPNN9988y9/+Uv/ZrBPUVC72+0+e/asRqMxm80dHR1nzpzpk9XmOE6SJGUHz5kzp6CgYNOmTTzPZ2RkaDSa06dPf/bZZ0ajcd68ef3kvQ5YVxorUu4luaux+ylEzgDDomYPPA2Y/GvoHeex4/2oSqfTPfLII2fOnFHcoC5VKR7GvHnzUlNTBzS1/Pz82tra++67TzmcxowZM378+E2bNhUVFcXHx3ffFkqnTABLly49ePDgjh07JkyYcO+99w707laGYXQ6nSzLysZNTEz0+XzffvvtTTfdFBkZ2fVYa2ur4norhgRARkbGzJkz169fv2HDBqPRyHGcy+WSJGnJkiVpaWmD9oIpZP8PRWOhmZj0R5R+jLN7QQCtFWnLEDWjy7pD8vfQF9f7d06dOvX555/fuXPnqVOn/H4/wzCCIJw6dSo3N7ekpOSZZ57p4WD2I2fPnj106FBERER6ejoAp9NpNBrT09O3bduWm5s7bdq0oKCg3njBZDI9+eST5eXlf//73zMyMtLS0gYU0VCuMlUYFgBpaWkzZ87cs2fPH/7wh6lTp4aEhPh8vqampuLiYsW+TZw4UcELBw8e3Lt3r9lsvuGGGyIiIhiGaW5uzsnJUbyIWbNmDaqBP2FhicOprWgqRvAoEAaOcbDGw98KSqEyQRvUmRPWVAxPBazze5xbwy7wNesCKxtr8uTJaWlpCrmiQKOzZ89+9NFHio/59NNPBzj60aNHCwsLFyxYEBMT8/777+/Zs0ej0ShEXG5ubm1tbe9dpUh6evrDDz/86quvvv7662vXrtVoBtAyUxCElpYWjUaj4PioqKjf/va3Wq127969+/fv12g0DMPY7XaFA+N5fuTIkdHR0U6n85NPPikqKvrNb35z5513Kj6c2+3Ozs5+6aWX3nnnncTExEAi9xe2yxzi5qJ6O3J+j6n/07mxtHZoz3cAmkuwfyXsIxE/vzsB2B9dq9fr9d1K6uPj41Uq1Z49ewK/lVmpIuJ5fuLEiSzLlpeX19TUKGjYZrNVV1cfOnQoJSXlQlDlnnvuyc3N3bVr1xdffHHXXXcFnjbE83x5ebnRaIyIiFDevLFjx65aterYsWOVlZUulys0NNRsNm/cuFH53/HjxwM4efJkSUlJWlrarFmzgoODu1DiokWL/vOf/3z11VeVlZU9DtcBizkKU19Czv/BznugigJhz4uLEwJZglgDUxymvtSDVh9YECQ0NNRgMLjdbkEQArHaJ06cOHLkSGpqamJiotlsfvTRR++9916lVO3w4cNr167dtWvXLbfc0v2o7y5arXb58uUlJSXr168PDw/XarV9Hkt9HpC5ubkOh6OLLGYYxuFwOBwOxT1iGGbLli1K5sWcOXMUVfl8Po/HExcX1xuUW61WxYeTZXmwiWb2ZNz0N5zaduHQ4u2Indt5pcGPUxWltKqqqr293WazBXi6HjlypLi4+IEHHoiPj+9MkjknDofjyy+/zMvLKy8vv5CqACQnJz/22GMvvPDCG2+80dzc7HA4ehjq3oaxtbX13XffdblcixcvDgsL623bAXz77bdr166NiYkBsGTJEsVOms1mi8VSW1vb0tLSnUnx+Xy1tbUqlcpmsw1NQqAxAqMfhiz1QR4RgGEDDdjLspydne31eseOHRsaGqpYJ7/ff+DAgbfeestoNE6fPj0Qb7S1tbWgoMBgMGRlZfVG20ajcdKkSXl5ebm5uVlZWSaT6UKZtosXLy4oKPjqq68EQeiuVCXlRilPF0WRUtre3n7s2LFNmzZ9880348aNW7p0aZ+28d///ve6deu0Wu2yZcsUfNjFISUnJ2/ZsuWzzz575JFHYmJiCCFOp3Pjxo0HDx5MT09XVDtETAV3fkXTj4IVsix/9dVXu3btCgoKstlsQUFBHMc1NzdXVFS0trYuWLBg0aJFvUfpyk7t7uTv27cvMzNz1KhRfX7x1KlTt2zZsnXr1rlz56anp3s8Hp7ne5eYazSaJ5988ujRozU1Ne3t7V0Wz+PxeL3eJ554QnGhFPe5ra2tubn5pptuWrZsWe/NWl1d/eGHH27atMnhcPzXf/1XF/WuiMlkuueee8rLyz///PMDBw7Ex8er1era2tri4uLg4OCHH344PDz86kKADMMsWrRIrVafPn26oaGhoaFBlmWdTpeWljZ9+vTZs2f3SVk6HI709PTuJs7pdEZERNx8880Xsm9paWm33nrrrl27WlpaACQkJGRlZfVZXB4bG7t8+fJPPvkkLCysi8FKS0szGAyiKCrvB6XUYrGkp6dnZY2fMWNaaGgfzTJra2uzs7MzMjKeeuqpPl3azMzM1atXb9++/cCBA6WlpYpVvO222xYuXDh+/PgrfitaH9m1oii6XC6vl/cJoij4JFHUaDR6vd5qtV4IrXl5vrml1WgwWC1mZeGcTmdHR4fdbu+HGXI6nU6n0263m81mp9PpcrmCg4P7hA+CINQ3NqtUXGhwkBLzbWho6F6MTillWVavN1gsFuYCxQdOp/PkyZN2uz0uLq6fFXG5XE6n0+v1KpFli8ViMpkuekr9uOzagaH9YdfyGnaBOY6zWq1Wq4jWElhiwVyYMOVbFVZYp7NEmnww2rsghs1muyi/2ZWL0uPfvUWlUkVa/ZA8IMHK+D3Q4LnNJcFVC397n/lAVqs1Kyvr4gDNaPwRHPFlkAvsKirjzBGUfw30Wx/o64CvA/Xfo6UCdd/D57lU0xR5HPv84uP7O1D+JfiW62NXURkNR1C7F54OQMb37yNyGizxKN0Evq2TIImeAUss6g9DYwWApAUgBH4PnCfBqWBPRf0hcAaEnEugkPyo+Q7NJaAsqA+mcISko6kIHXVgVJBlyDwc6YiYCpng1Ha013T2qEuYD10ITnwBTyP4NlR+g47TiJ2LM/tRdxCsFiIPexwSFkJwo2wrOmrh64Dsh7cZCfPhd+P0DnScBSXQGBA1HRorKr+GpwmsrrPrMpURPhn2RFTvQkslCAfJC1sSLHFoLoK7AawOVIboRdR0hI7tQfZc0V1FJZRuRU0uomcgcgrM0VCZ4axA4QfgdLAlgG9G/quoy0X1t2g8gsYjUOnB6cAwqP4PanbD78GJL1G154cxPc0o2YT2atgTYEuEYQRUOujDYHCg7J/oOA1TJPQOeFuxewWqvoXWBkssVAbIAlorcOQ9GEYgehZsSTCEARQlG+GqhDUOuiCUbsLBN8C3oXgjNBbE3Qz7SBjD4W5E3quoyYU1EZY4sCrw7WDU0IfBFImgFPBO8E6UfQF3HdqqULYVogf2kbDEwxgGjQWGCGjMOPUl+CZYYqAxX9nL5vrCKlSAMRpR0yALnex9fT3UJsTcAms0zFHY+yzaq0FUEPzd+QzIIiQJDANQnBfhFgEGwaMRMxOyBAIwKhjCIflx8t8IG4fEeeD0OPQaqICs38EYCUJBKTgNanOhMSJqOgyhkGWwHCiF4MeISYi9BRIP5wlU7UPyHVDpEDkN9mRIAlRaNB3HmQNIfwQJczu/VKlIiZoGVoOmY+ioAoCkOxA3B2cOQOYQnIbYmZB8IAwYFqZw2OJQ+x3CJiLmJhByZWuQuT7IDZUB1dux/0WIXqj0GH0fWC0YFWQeldtQ9k+EpMGRhZZPz6OqlObGVLmSgj2vqTujAZVx4l9oq4TPBWsCUu6EPgQyA0oA0mlVWsoQMRnG8M72FnwzQKEywtOE/L9CY4HfjegZSJgLVgWiQUsZij9BaynG/waEhasRBetgioTAY8R4JPwMSYtw4p+oLQBkWKORvBimCLAatJThyPrOe2zGPAAAnA5iO45/grp8iB1wZCH+Z9BYQNjOnRRAdwGlXvZyqopC8sORhtR7IfrAqWAIg7cEhEDkIfiReAdiboH7DISO8xthsqAEVAJhQM//bUrXs+gbkTAfkg8qI7TWzu8i3eqk1Hp0nIXk7+x1cPAt2JIRMhbaEIy6GxobqARtcOcOJgSSF5ZojH4A1jg4K6CzInkxbAmQBWgt4HRIfxSJi+BpgOTHyf9F/l8x8//CXYfv34NhBLKeBM71VRD8YI2ImozIGRC90NmgMijkzblbPgOKZ15mVQE+FygLUwQEvrNCQRLga4faiKRFoDIYDhorDOE4tRMAom6E3oG6/ag/gsRFoBJENzwN8Lvg90Klg8hD8IDVwxgBuXscmsLvhniuFWriHch9EaZwRM+GPgiNxdBaIYuQvNCFQO8AJBAWsgzqg9iO0HQEpYLhzvUJFKEPhjEckgCGheSDqx6cCqGZ4JvBquFtgasWR9fD50T6YxD9nT/WEAzqBxWhtcMUBcHVLfxKIftAL178ajAY/vjHP0ZFRV2iGu9hF/iaBuuEQUgKKv6NfWsg+cEySFwEYySCUqDSg5y7t1FjRer9KN4IAPtfgsYM0Y3EeRh1FwQexkicyUXOi5B4mCMRPRNBiajNRlsFZD90NqTcA1sCKIPgkdAHd9afhk/B5D+i/F+oLwKrAkMRmgF9EPRBOPg3qPSQeASNROoDsKdAHwbgh2tHOAu0wSh8F1o7JB72RIy8E3W5qNoDtQ2iB1oTJj0NbyPaysGaUPQx/O0AoDYi5W5YY2AJQdlW1OZBcMEcjdS7YYyASg1bEnQXz1VSq9WLFi26pM0v+qqwl/wQXJ03ZkOG2gKVDhIPVtsTrUo+APC3Q/RBbYTa0tk4WvJB9ED0AzJYDmoLAAguyCJkqdN+smpQCokHq+oWoaGQBfCtkARozFAZQQj8bgjuTkeC00Jrg+jrvFyy+xHr64DEg1KAglFDY4EswN8GSQCrgsYKVgMqQvBA8kOWzrUZJ9BYwGoheiB4IEuA1PlxRgUqQ/KBUQ26adElUtWwXJUyfFYNq2pYhlV13cr/BwEXS705Z/8EAAAAAElFTkSuQmCC';

  const SIGNATURE_HTML = [
    '<p style="margin:0;color:#e00000;font-family:Calibri,Arial,sans-serif;font-size:11pt;font-style:italic;font-weight:bold">Kérjük, hogy a szállítólevélen és a számlán a projekt nevét, kódját,&nbsp; rendelésszámát tüntessék fel! A&nbsp; számla mögé kérjük csatolni az aláírt szállítólevelet!<br>Ezek hiányában a számlát nem áll módunkban befogadni!</p>',
    '<p style="margin:0">&nbsp;</p>',
    '<p style="margin:0;color:#e00000;font-family:Calibri,Arial,sans-serif;font-size:11pt;font-style:italic;font-weight:bold">Szigetszentmiklósi központi raktárunk hétköznapokon 10:00–14:00 között fogad árut!</p>',
    '<p style="margin:0">&nbsp;</p>',
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>',
    '<td style="vertical-align:top;padding:0"><img src="cid:stand98logo@fuvarszervezo" width="142" height="108" alt="STAND98 Épületgépészet" style="display:block;border:0"></td>',
    '<td style="vertical-align:top;padding:0 0 0 4px;font-family:Arial,sans-serif">',
    '<div style="font-size:17pt;color:#222;line-height:1.2">Szabó <span style="color:#f08a24">Sándor</span></div>',
    '<div style="font-size:9pt;color:#7a7a7a;line-height:1.6">Logisztikai vezető</div>',
    '<div style="font-size:9pt;color:#7a7a7a;line-height:1.6">1239 Láva utca 7.</div>',
    '<div style="font-size:10pt;color:#222;line-height:1.6">+36 70 453 60 29</div>',
    '<div style="font-size:10pt;line-height:1.6"><a href="mailto:szabo.sandor@stand98.hu" style="color:#0000ee">szabo.sandor@stand98.hu</a></div>',
    '</td></tr></table>',
    '<p style="margin:0;color:#f08a24;font-family:Calibri,Arial,sans-serif;font-size:11pt;font-style:italic;font-weight:bold">Bizonylataikon kérem minden esetben szíveskedjenek feltüntetni megrendelésszámunkat!</p>'
  ].join('');
  const SIGNATURE_TEXT = [
    'Kérjük, hogy a szállítólevélen és a számlán a projekt nevét, kódját, rendelésszámát tüntessék fel! A számla mögé kérjük csatolni az aláírt szállítólevelet!',
    'Ezek hiányában a számlát nem áll módunkban befogadni!', '',
    'Szigetszentmiklósi központi raktárunk hétköznapokon 10:00–14:00 között fogad árut!', '',
    'Szabó Sándor', 'Logisztikai vezető', 'STAND98 Épületgépészet', '1239 Láva utca 7.', '+36 70 453 60 29', 'szabo.sandor@stand98.hu', '',
    'Bizonylataikon kérem minden esetben szíveskedjenek feltüntetni megrendelésszámunkat!'
  ].join('\n');

  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  function b64Bytes(bytes) {
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return (global.btoa || (s => Buffer.from(s, 'binary').toString('base64')))(bin);
  }
  const utf8 = text => (typeof TextEncoder !== 'undefined')
    ? new TextEncoder().encode(text)
    : Uint8Array.from(unescape(encodeURIComponent(text)), c => c.charCodeAt(0));
  const b64Text = text => b64Bytes(utf8(text));
  const wrap = s => s.replace(/.{1,76}/g, '$&\r\n').replace(/\r\n$/, '');
  const encWord = text => `=?UTF-8?B?${b64Text(text)}?=`;
  function dataUrlBytes(dataUrl) {
    const m = String(dataUrl || '').match(/^data:[^,]*;base64,(.*)$/);
    if (!m) return null;
    const bin = (global.atob || (s => Buffer.from(s, 'base64').toString('binary')))(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bodyHtml() {
    return `<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${TEXT_LINES.map(l => l ? esc(l) : '').join('<br>')}<br><br>${SIGNATURE_HTML}</body></html>`;
  }
  const bodyText = () => `${TEXT_LINES.join('\n')}\n\n${SIGNATURE_TEXT}`;

  /* a rendelés PDF-je: előbb a helyben tárolt eredeti melléklet, utána a
     szerver; a „Vevői ajánlat” és társai csak végső esetben */
  function pickPdf(files) {
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name || ''));
    return pdfs.find(f => /megrendel/i.test(f.name) && !/aj[aá]nlat/i.test(f.name))
      || pdfs.find(f => !/aj[aá]nlat/i.test(f.name)) || pdfs[0] || null;
  }
  async function orderPdfV155(order) {
    const ids = [...new Set([order?.id, order?.attachFromOrderIdV153, order?.movedFromOrderId].filter(Boolean).map(String))];
    for (const id of ids) {
      const local = typeof global.loadOrderAttachmentsV73 === 'function' ? global.loadOrderAttachmentsV73(id) : [];
      const hit = pickPdf((local || []).map(f => ({ name: f.name || f.fileName || '', dataUrl: f.dataUrl })));
      const bytes = hit && dataUrlBytes(hit.dataUrl);
      if (bytes) return { name: hit.name, bytes };
    }
    for (const id of ids) {
      try {
        const list = await global.V44Online?.listDeliveryFiles?.(id);
        const hit = pickPdf((list || []).filter(f => f.url).map(f => ({ name: f.file_name || '', url: f.url })));
        if (!hit) continue;
        const res = await fetch(hit.url);
        if (!res.ok) continue;
        return { name: hit.name, bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch (error) { console.warn('[V155] a melléklet letöltése', error); }
    }
    return null;
  }

  function buildEmlV155(pdf) {
    const mix = 'mix_' + Math.random().toString(36).slice(2), rel = 'rel_' + Math.random().toString(36).slice(2);
    const parts = [
      'X-Unsent: 1', 'To: ', `Subject: ${encWord(SUBJECT)}`, 'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${mix}"`, '',
      `--${mix}`, `Content-Type: multipart/related; boundary="${rel}"`, '',
      `--${rel}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(b64Text(bodyHtml())), '',
      `--${rel}`, 'Content-Type: image/png; name="stand98.png"', 'Content-Transfer-Encoding: base64', 'Content-ID: <stand98logo@fuvarszervezo>',
      'Content-Disposition: inline; filename="stand98.png"', '', wrap(LOGO_PNG_B64), '', `--${rel}--`, ''
    ];
    if (pdf) {
      parts.push(`--${mix}`, `Content-Type: application/pdf; name="${encWord(pdf.name)}"`, 'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${encWord(pdf.name)}"`, '', wrap(b64Bytes(pdf.bytes)), '');
    }
    parts.push(`--${mix}--`, '');
    return parts.join('\r\n');
  }

  function isMobile() {
    const ua = String(global.navigator?.userAgent || '');
    return /iPhone|iPad|iPod|Android/i.test(ua) || (global.navigator?.maxTouchPoints > 1 && /Macintosh/.test(ua));
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  async function mailPendingV155(recId) {
    const rec = (st().pendingOrdersV151 || []).find(r => String(r.id) === String(recId));
    if (!rec) return;
    const pdf = await orderPdfV155(rec.order || {});
    const safeNo = String(rec.orderNo || rec.order?.orderNo || 'rendeles').replace(/[^0-9A-Za-z_-]+/g, '_');
    if (isMobile() && pdf && typeof global.navigator?.canShare === 'function') {
      const file = new File([pdf.bytes], pdf.name, { type: 'application/pdf' });
      if (global.navigator.canShare({ files: [file] })) {
        try { await global.navigator.share({ files: [file], title: SUBJECT, text: bodyText() }); return 'share'; }
        catch (error) { if (error?.name === 'AbortError') return 'cancel'; }
      }
    }
    if (!pdf) global.alert?.('Ehhez a függő rendeléshez nem találtam rendelés-PDF-et – a levél melléklet nélkül készül el.');
    download(`Hatralek_informacio_${safeNo}.eml`, buildEmlV155(pdf));
    global.toastV147?.('A levél letöltődött – nyisd meg, és az Outlook kész piszkozatként mutatja.');
    return 'eml';
  }

  /* ---------- „Korábban teljesült” felirat ---------- */
  function fmtDay(v) { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}.${m[2]}.${m[3]}.` : ''; }
  function driverName(id) { const v = (st().vehicles || []).find(x => String(x.id) === String(id)); return v ? (v.driverName || v.name || '') : ''; }
  function earlierCompletionV155(order) {
    const refs = global.v153Refs ? global.v153Refs(order) : [];
    if (!refs.length || order.completed) return null;
    const since = order.linkFromV155 ? Date.parse(order.linkFromV155) : NaN;
    let best = null;
    for (const o of st().orders || []) {
      if (o === order || String(o.id) === String(order.id) || !o.completed) continue;
      if (!global.v153Refs(o).some(r => refs.includes(r))) continue;
      const doneAt = Date.parse(o.completedAtV111 || o.completedAt || '') || Date.parse(o.scheduleDate || '');
      const earlier = Number.isFinite(since) ? doneAt < since : String(o.scheduleDate || '') < String(order.scheduleDate || '');
      if (!earlier) continue;
      if (!best || String(o.scheduleDate) > String(best.scheduleDate)) best = o;
    }
    return best;
  }
  function decorateEarlierV155(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('article.bubble[data-id]').forEach(el => {
      const order = (st().orders || []).find(o => String(o.id) === String(el.dataset.id));
      const prev = order ? earlierCompletionV155(order) : null;
      const mark = el.querySelector(':scope > .v155-earlier');
      if (!prev) { mark?.remove(); return; }
      const label = `Korábban teljesült: ${fmtDay(prev.scheduleDate)}${driverName(prev.vehicleId) ? ' · ' + driverName(prev.vehicleId) : ''}`;
      if (mark) { if (mark.textContent !== label) mark.textContent = label; return; }
      const small = document.createElement('small');
      small.className = 'v155-earlier'; small.textContent = label;
      el.appendChild(small);
    });
  }
  let queued = false;
  function schedule() {
    if (queued) return; queued = true;
    (global.requestAnimationFrame || (fn => setTimeout(fn, 16)))(() => { queued = false; decorateEarlierV155(document); });
  }
  function install() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('v155Css')) {
      const css = document.createElement('style'); css.id = 'v155Css';
      css.textContent = '.v155-earlier{display:block;margin-top:4px;font-size:.8em;font-weight:600;color:#15803d}';
      document.head.appendChild(css);
    }
    decorateEarlierV155(document);
    try { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
  }

  global.v155MailPending = mailPendingV155;
  global.v155BuildEml = buildEmlV155;
  global.v155OrderPdf = orderPdfV155;
  global.v155EarlierCompletion = earlierCompletionV155;
  global.v155DecorateEarlier = decorateEarlierV155;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
  }
})(typeof window !== 'undefined' ? window : globalThis);
