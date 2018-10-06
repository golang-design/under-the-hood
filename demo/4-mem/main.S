TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/4-mem/main.go
  main.go:3		0x104df10		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:3		0x104df19		483b6110		CMPQ 0x10(CX), SP			
  main.go:3		0x104df1d		761a			JBE 0x104df39				
  main.go:3		0x104df1f		4883ec08		SUBQ $0x8, SP				
  main.go:3		0x104df23		48892c24		MOVQ BP, 0(SP)				
  main.go:3		0x104df27		488d2c24		LEAQ 0(SP), BP				
  main.go:4		0x104df2b		e8e0ffffff		CALL main.main(SB)			
  main.go:5		0x104df30		488b2c24		MOVQ 0(SP), BP				
  main.go:5		0x104df34		4883c408		ADDQ $0x8, SP				
  main.go:5		0x104df38		c3			RET					
  main.go:3		0x104df39		e87289ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:3		0x104df3e		ebd0			JMP main.main(SB)			
