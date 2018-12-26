TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/5-mem/main.go
  main.go:3		0x104e020		65488b0c2530000000	MOVQ GS:0x30, CX			
  main.go:3		0x104e029		483b6110		CMPQ 0x10(CX), SP			
  main.go:3		0x104e02d		761a			JBE 0x104e049				
  main.go:3		0x104e02f		4883ec08		SUBQ $0x8, SP				
  main.go:3		0x104e033		48892c24		MOVQ BP, 0(SP)				
  main.go:3		0x104e037		488d2c24		LEAQ 0(SP), BP				
  main.go:4		0x104e03b		e8e0ffffff		CALL main.main(SB)			
  main.go:5		0x104e040		488b2c24		MOVQ 0(SP), BP				
  main.go:5		0x104e044		4883c408		ADDQ $0x8, SP				
  main.go:5		0x104e048		c3			RET					
  main.go:3		0x104e049		e87289ffff		CALL runtime.morestack_noctxt(SB)	
  main.go:3		0x104e04e		ebd0			JMP main.main(SB)			
